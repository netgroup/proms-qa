<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { dict, type Lang } from './i18n'
import { parseWorkbook } from './lib/xlsx-io'
import { validateWorkbook } from './lib/validate'
import { preprocess, toStanData } from './lib/preprocess'
import { generateTemplateWorkbook } from './lib/template'
import { postprocess } from './lib/postprocess'
import { buildOutputWorkbook } from './lib/output-xlsx'
import type {
  AppConfig,
  McmcSettings,
  ValidationResult,
  ParsedWorkbook,
  PreprocessedData,
  StanData,
  SerializedSamplerResult,
  OutputTables,
  Diagnostics,
} from './lib/types'
import SamplerWorker from './workers/sampler.worker.ts?worker'

const lang = ref<Lang>('en')
const theme = ref<'light' | 'dark'>('light')
const t = computed(() => dict(lang.value))

const config = shallowRef<AppConfig | null>(null)
const configError = ref<string | null>(null)

const stage = ref<'idle' | 'validating' | 'validated' | 'invalid'>('idle')
const fileName = ref<string>('')
const fileSize = ref<number>(0)
const validation = ref<ValidationResult | null>(null)
const parsed = shallowRef<ParsedWorkbook | null>(null)
const pre = shallowRef<PreprocessedData | null>(null)
const stanData = shallowRef<StanData | null>(null)

const settingsOpen = ref(false)
const quickMode = ref(false)
const mcmc = ref<McmcSettings>({
  seed: 42,
  chains: 4,
  warmup: 1000,
  draws: 1000,
  adaptDelta: 0.9,
})

const running = ref<'no' | 'analyzing' | 'done'>('no')
const phase = ref<'warmup' | 'sampling'>('warmup')
const progress = ref(0)
const diagnostics = ref<Diagnostics | null>(null)
const outputTables = shallowRef<OutputTables | null>(null)
const workerRef = shallowRef<Worker | null>(null)
const runStartTs = ref(0)

const toast = ref<string | null>(null)
let toastTimer: number | null = null
function showToast(msg: string) {
  toast.value = msg
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2400)
}

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

onMounted(async () => {
  try {
    const r = await fetch(import.meta.env.BASE_URL + 'config.json')
    if (!r.ok) throw new Error(`config.json HTTP ${r.status}`)
    config.value = (await r.json()) as AppConfig
    mcmc.value = { ...config.value.defaultMcmc }
  } catch (e) {
    configError.value = e instanceof Error ? e.message : String(e)
  }
})

async function onFile(file: File) {
  fileName.value = file.name
  fileSize.value = file.size
  stage.value = 'validating'
  validation.value = null
  parsed.value = null
  pre.value = null
  stanData.value = null
  running.value = 'no'
  outputTables.value = null

  try {
    const wb = await parseWorkbook(file)
    parsed.value = wb
    if (!config.value) throw new Error('Config non caricato')
    const v = validateWorkbook(wb, config.value)
    validation.value = v
    if (v.hasErrors) {
      stage.value = 'invalid'
    } else {
      const p = preprocess(wb, config.value)
      pre.value = p
      stanData.value = toStanData(p)
      stage.value = 'validated'
    }
  } catch (e) {
    validation.value = {
      issues: [
        {
          code: 'E1',
          severity: 'error',
          message: `Impossibile leggere il file: ${e instanceof Error ? e.message : String(e)}`,
        },
      ],
      hasErrors: true,
    }
    stage.value = 'invalid'
  }
}

function pickFile() {
  fileInput.value?.click()
}
function onFileChange(evt: Event) {
  const inp = evt.target as HTMLInputElement
  const f = inp.files?.[0]
  if (f) void onFile(f)
  inp.value = ''
}
function onDrop(evt: DragEvent) {
  evt.preventDefault()
  dragOver.value = false
  const f = evt.dataTransfer?.files?.[0]
  if (f) void onFile(f)
}
function onDragOver(evt: DragEvent) {
  evt.preventDefault()
  dragOver.value = true
}
function onDragLeave() {
  dragOver.value = false
}
function clearFile() {
  workerRef.value?.terminate()
  workerRef.value = null
  stage.value = 'idle'
  running.value = 'no'
  progress.value = 0
  fileName.value = ''
  fileSize.value = 0
  validation.value = null
  parsed.value = null
  pre.value = null
  stanData.value = null
  outputTables.value = null
  diagnostics.value = null
}

async function downloadTemplate() {
  if (!config.value) return
  const blob = await generateTemplateWorkbook(config.value)
  downloadBlob(blob, 'ePROM-template.xlsx')
  showToast(t.value.toastTemplate)
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function applyQuickMode(on: boolean) {
  quickMode.value = on
  if (!config.value) return
  if (on) {
    const q = config.value.quickModeMcmc
    mcmc.value = {
      ...mcmc.value,
      chains: q.chains ?? mcmc.value.chains,
      warmup: q.warmup ?? mcmc.value.warmup,
      draws: q.draws ?? mcmc.value.draws,
    }
  } else {
    mcmc.value = { ...mcmc.value, ...config.value.defaultMcmc }
  }
}

function runAnalysis() {
  if (stage.value !== 'validated' || !stanData.value || !pre.value || !config.value) return
  workerRef.value?.terminate()
  running.value = 'analyzing'
  phase.value = 'warmup'
  progress.value = 0
  diagnostics.value = null
  outputTables.value = null
  runStartTs.value = performance.now()

  const worker = new SamplerWorker()
  workerRef.value = worker
  worker.onmessage = (evt: MessageEvent) => {
    const msg = evt.data as {
      type: 'progress' | 'done' | 'error'
      progress?: { phase: 'warmup' | 'sampling'; percent: number }
      result?: SerializedSamplerResult
      error?: string
    }
    if (msg.type === 'progress' && msg.progress) {
      phase.value = msg.progress.phase
      progress.value = Math.min(100, msg.progress.percent)
    } else if (msg.type === 'done' && msg.result) {
      progress.value = 100
      diagnostics.value = msg.result.diagnostics
      const out = postprocess(msg.result, pre.value!, stanData.value!, config.value!)
      outputTables.value = out
      running.value = 'done'
      worker.terminate()
      workerRef.value = null
    } else if (msg.type === 'error') {
      showToast('Errore sampler: ' + (msg.error ?? 'sconosciuto'))
      running.value = 'no'
      worker.terminate()
      workerRef.value = null
    }
  }
  worker.postMessage({
    type: 'run',
    data: stanData.value,
    mcmc: {
      ...mcmc.value,
      adaptDelta: config.value.defaultMcmc.adaptDelta,
    },
  })
}

async function downloadResults() {
  if (!outputTables.value) return
  const blob = await buildOutputWorkbook(outputTables.value)
  const base = fileName.value.replace(/\.xlsx?$/i, '') || 'ePROM'
  downloadBlob(blob, `${base}_quality.xlsx`)
  showToast(t.value.toastResults)
}

const errors = computed(() => (validation.value?.issues ?? []).filter((i) => i.severity === 'error'))
const warnings = computed(() => (validation.value?.issues ?? []).filter((i) => i.severity === 'warning'))
const isValid = computed(() => stage.value === 'validated')
const runBlocked = computed(() => !isValid.value || running.value === 'analyzing')

const runtimeText = computed(() => {
  const ms = diagnostics.value?.runtimeMs ?? 0
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s - m * 60
  return `${m}:${rem.toString().padStart(2, '0')}`
})

const humanFileSize = computed(() => {
  const b = fileSize.value
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
})

const sheetsDetected = computed(() => {
  if (!parsed.value) return ''
  const names = Object.values(parsed.value.sheetNames).filter(Boolean)
  return names.join(', ')
})

const detectedSummary = computed(() => {
  if (!pre.value) return ''
  return `${pre.value.nParticipants} partecipanti · ${pre.value.nQuestionnaires} questionari · ${pre.value.directCols.length + pre.value.fatigueCols.length + pre.value.confidenceCols.length} segnali`
})

const baseUrl = import.meta.env.BASE_URL
</script>

<template>
  <div
    :data-theme="theme"
    :style="{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: `'IBM Plex Sans', system-ui, sans-serif`,
      WebkitFontSmoothing: 'antialiased',
      lineHeight: '1.5',
    }"
  >
    <!-- HEADER -->
    <header
      style="position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:20px;padding:14px 28px;background:color-mix(in srgb, var(--surface) 82%, transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--border)"
    >
      <div style="display:flex;align-items:center;gap:14px;min-width:0">
        <img :src="`${baseUrl}logo_tv.png`" alt="Università di Roma Tor Vergata" style="height:30px;width:auto;flex:none" />
        <div style="width:1px;height:26px;background:var(--border);flex:none"></div>
        <div style="min-width:0">
          <div style="font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap">{{ t.productName }}</div>
          <div style="font-size:11.5px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ t.tagline }}</div>
        </div>
      </div>
      <div style="flex:1"></div>
      <div
        style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:500;color:var(--green-fg);background:var(--green-tint);border:1px solid color-mix(in srgb,var(--green) 30%,transparent);padding:6px 11px;border-radius:999px;white-space:nowrap"
      >
        <span style="width:7px;height:7px;border-radius:50%;background:var(--green);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 22%,transparent)"></span>
        {{ t.privacyShort }}
      </div>
      <div style="display:inline-flex;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;font-size:12px;font-weight:600">
        <button
          @click="lang = 'en'"
          :style="{padding:'7px 12px',background: lang==='en'?'var(--primary)':'var(--surface)',color: lang==='en'?'var(--on-primary)':'var(--text-2)',border:'none',cursor:'pointer',font:'inherit'}"
        >EN</button>
        <button
          @click="lang = 'it'"
          :style="{padding:'7px 12px',background: lang==='it'?'var(--primary)':'var(--surface)',color: lang==='it'?'var(--on-primary)':'var(--text-2)',border:'none',cursor:'pointer',font:'inherit'}"
        >IT</button>
      </div>
      <button
        @click="theme = theme==='dark'?'light':'dark'"
        title="Toggle theme"
        style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:34px;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer"
      >
        <span v-if="theme==='dark'" style="font-size:15px">☀</span>
        <span v-else style="font-size:14px">☾</span>
      </button>
    </header>

    <main style="max-width:1080px;margin:0 auto;padding:44px 28px 24px">
      <!-- HERO -->
      <section style="margin-bottom:34px">
        <div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--primary);margin-bottom:12px">{{ t.kicker }}</div>
        <h1 style="margin:0 0 14px;font-size:38px;line-height:1.08;letter-spacing:-.025em;font-weight:600;max-width:22ch">{{ t.heroTitle }}</h1>
        <p style="margin:0 0 12px;font-size:16px;color:var(--text-2)">
          {{ t.heroIntro }}
          <i>ePROMs-QA: Assessing Response Quality in Remotely Administered Patient-Reported Outcome Measures</i>
          {{ t.paperStatus }}.
        </p>
        <p style="margin:0 0 12px;font-size:16px;color:var(--text-2)">
          {{ t.heroHow1 }}<a href="#" @click.prevent="downloadTemplate" style="color:var(--primary);font-weight:600">{{ t.heroTemplateLink }}</a>{{ t.heroHow2 }}
        </p>
        <p style="margin:0;font-size:16px;color:var(--text-2)">
          {{ t.heroPrivacy }}
          {{ t.heroContact }}
          <a href="mailto:giorgia.panico@uniroma2.it" style="color:var(--primary);font-weight:600">{{ t.heroContactLink }}</a>.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:22px">
          <div style="display:flex;align-items:center;gap:11px;background:var(--primary-tint);border:1px solid color-mix(in srgb,var(--primary) 26%,transparent);padding:11px 15px;border-radius:12px">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span style="font-size:13px;font-weight:600;color:var(--primary-600)">{{ t.privacyLong }}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:26px">
          <div v-for="(step, idx) in [
            { title: t.step1, sub: t.step1sub },
            { title: t.step2, sub: t.step2sub },
            { title: t.step3, sub: t.step3sub },
          ]" :key="idx"
            style="display:flex;gap:13px;align-items:flex-start;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow)"
          >
            <div style="width:30px;height:30px;flex:none;border-radius:9px;background:var(--surface-3);display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:var(--primary)">{{ idx + 1 }}</div>
            <div>
              <div style="font-size:14px;font-weight:600">{{ step.title }}</div>
              <div style="font-size:12.5px;color:var(--text-2);margin-top:2px">{{ step.sub }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- STEP 1 · UPLOAD -->
      <section style="background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow);overflow:hidden;margin-bottom:22px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 22px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:11px">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:var(--text-3);letter-spacing:.05em">{{ t.stepLabel }} 1</span>
            <h2 style="margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em">{{ t.uploadTitle }}</h2>
          </div>
          <button
            @click="downloadTemplate"
            style="display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text);background:var(--surface);border:1px solid var(--border-strong);padding:9px 14px;border-radius:9px;cursor:pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
            {{ t.downloadTemplate }}
          </button>
        </div>

        <div style="padding:22px">
          <input ref="fileInput" type="file" accept=".xlsx" style="display:none" @change="onFileChange" />

          <!-- Dropzone -->
          <div
            v-if="stage === 'idle'"
            :class="['dz', dragOver ? 'drag' : '']"
            @click="pickFile"
            @drop="onDrop"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            role="button"
            tabindex="0"
            style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:44px 24px;border:2px dashed var(--border-strong);border-radius:14px;background:var(--surface-2)"
          >
            <div style="width:52px;height:52px;border-radius:14px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;margin-bottom:6px;box-shadow:var(--shadow)">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            </div>
            <div style="font-size:15px;font-weight:600">{{ t.dropTitle }}</div>
            <div style="font-size:13px;color:var(--text-2)">{{ t.dropSub }}</div>
            <div style="margin-top:12px;display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--on-primary);background:var(--primary);padding:9px 16px;border-radius:9px">{{ t.browse }}</div>
            <div style="margin-top:10px;font-size:11.5px;color:var(--text-3)">{{ t.dropHint }}</div>
          </div>

          <!-- Validating -->
          <div v-else-if="stage === 'validating'" style="display:flex;align-items:center;gap:14px;padding:22px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2)">
            <div style="width:22px;height:22px;border-radius:50%;border:2.5px solid var(--border-strong);border-top-color:var(--primary);animation:epr-spin .7s linear infinite;flex:none"></div>
            <div>
              <div style="font-size:14px;font-weight:600">{{ t.validating }}</div>
              <div style="font-size:12.5px;color:var(--text-2);font-family:'IBM Plex Mono',monospace">{{ fileName }} · {{ humanFileSize }}</div>
            </div>
          </div>

          <!-- File chip + validation panel -->
          <template v-else-if="stage === 'validated' || stage === 'invalid'">
            <div style="display:flex;align-items:center;gap:13px;padding:13px 15px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);margin-bottom:16px">
              <div :style="{width:'34px',height:'34px',flex:'none',borderRadius:'8px',background: stage==='validated'?'var(--green-tint)':'var(--red-tint)',display:'flex',alignItems:'center',justifyContent:'center'}">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" :stroke="stage==='validated' ? 'var(--green-fg)' : 'var(--red-fg)'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
              </div>
              <div style="min-width:0;flex:1">
                <div style="font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ fileName }}</div>
                <div style="font-size:11.5px;color:var(--text-2);font-family:'IBM Plex Mono',monospace">{{ humanFileSize }} · {{ sheetsDetected }}</div>
              </div>
              <button @click="clearFile" title="Remove" style="width:30px;height:30px;flex:none;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-2);cursor:pointer;font-size:15px;line-height:1">×</button>
            </div>

            <!-- SUCCESS -->
            <div
              v-if="stage === 'validated' && errors.length === 0 && warnings.length === 0"
              style="display:flex;gap:13px;padding:16px;border:1px solid color-mix(in srgb,var(--green) 34%,transparent);border-radius:13px;background:var(--green-tint);animation:epr-fade .2s ease"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-fg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>
              <div>
                <div style="font-size:14px;font-weight:600;color:var(--green-fg)">{{ t.successTitle }}</div>
                <div style="font-size:13px;color:var(--text-2);margin-top:2px">{{ detectedSummary }}</div>
              </div>
            </div>

            <!-- WARNINGS (when no errors) -->
            <div
              v-if="stage === 'validated' && warnings.length > 0"
              style="padding:16px;border:1px solid color-mix(in srgb,var(--amber) 40%,transparent);border-radius:13px;background:var(--amber-tint);animation:epr-fade .2s ease"
            >
              <div style="display:flex;gap:13px;margin-bottom:8px">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--amber-fg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:1px"><path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/></svg>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--amber-fg)">{{ t.warnTitle }}</div>
                  <div style="font-size:13px;color:var(--text-2);margin-top:2px">{{ t.warnBody }}</div>
                </div>
              </div>
              <ul style="margin:6px 0 0;padding-left:34px;font-size:13px;color:var(--text-2);display:flex;flex-direction:column;gap:5px">
                <li v-for="(w, i) in warnings" :key="i">
                  <span style="font-family:'IBM Plex Mono',monospace;color:var(--amber-fg);font-weight:600">{{ w.sheet || '' }}{{ w.row ? ` · ${t.row} ${w.row}` : '' }}</span>
                  <template v-if="w.sheet || w.row"> — </template>{{ w.message }}
                </li>
              </ul>
            </div>

            <!-- ERRORS -->
            <div
              v-if="stage === 'invalid' && errors.length > 0"
              style="padding:16px;border:1px solid color-mix(in srgb,var(--red) 42%,transparent);border-radius:13px;background:var(--red-tint);animation:epr-fade .2s ease"
            >
              <div style="display:flex;gap:13px;margin-bottom:8px">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--red-fg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:1px"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.5"/></svg>
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--red-fg)">{{ t.errorTitle }}: {{ errors.length }}</div>
                  <div style="font-size:13px;color:var(--text-2);margin-top:2px">{{ t.errorBody }}</div>
                </div>
              </div>
              <ul style="margin:6px 0 0;padding-left:34px;font-size:13px;color:var(--text-2);display:flex;flex-direction:column;gap:5px">
                <li v-for="(err, i) in errors" :key="i">
                  <span style="font-family:'IBM Plex Mono',monospace;color:var(--red-fg);font-weight:600">
                    {{ err.sheet || '' }}{{ err.row ? ` · ${t.row} ${err.row}` : '' }}
                  </span>
                  <template v-if="err.sheet || err.row"> — </template>{{ err.message }}
                </li>
              </ul>
            </div>
          </template>

          <div v-if="configError" style="margin-top:14px;padding:12px;border:1px solid var(--red);border-radius:10px;background:var(--red-tint);color:var(--red-fg);font-size:13px">
            Errore caricamento config.json: {{ configError }}
          </div>
        </div>
      </section>

      <!-- STEP 2 · SETTINGS + RUN -->
      <section :style="{marginBottom:'22px',opacity:isValid?'1':'.55',transition:'opacity .2s'}">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow);overflow:hidden">
          <button
            @click="settingsOpen = !settingsOpen"
            style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 22px;background:none;border:none;cursor:pointer;text-align:left;color:var(--text)"
          >
            <div style="display:flex;align-items:center;gap:11px">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:var(--text-3);letter-spacing:.05em">{{ t.stepLabel }} 2</span>
              <h2 style="margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em">{{ t.settingsTitle }}</h2>
              <span style="font-size:12px;color:var(--text-3)">· {{ t.settingsHint }}</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="{transition:'transform .2s',transform:`rotate(${settingsOpen?180:0}deg)`}"><path d="M6 9l6 6 6-6"/></svg>
          </button>

          <div v-if="settingsOpen" style="padding:4px 22px 22px;border-top:1px solid var(--border)">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:18px">
              <label style="display:flex;flex-direction:column;gap:6px">
                <span style="font-size:12px;font-weight:600;color:var(--text-2)">{{ t.seed }}</span>
                <input v-model.number="mcmc.seed" type="number" style="font-size:14px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-2);color:var(--text)" />
              </label>
              <label style="display:flex;flex-direction:column;gap:6px">
                <span style="font-size:12px;font-weight:600;color:var(--text-2)">{{ t.chains }}</span>
                <input v-model.number="mcmc.chains" type="number" min="1" style="font-size:14px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-2);color:var(--text)" />
              </label>
              <label style="display:flex;flex-direction:column;gap:6px">
                <span style="font-size:12px;font-weight:600;color:var(--text-2)">{{ t.warmup }}</span>
                <input v-model.number="mcmc.warmup" type="number" min="50" style="font-size:14px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-2);color:var(--text)" />
              </label>
              <label style="display:flex;flex-direction:column;gap:6px">
                <span style="font-size:12px;font-weight:600;color:var(--text-2)">{{ t.draws }}</span>
                <input v-model.number="mcmc.draws" type="number" min="50" style="font-size:14px;padding:9px 11px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface-2);color:var(--text)" />
              </label>
            </div>

            <div
              @click="applyQuickMode(!quickMode)"
              style="display:flex;align-items:center;gap:13px;margin-top:16px;padding:13px 15px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);cursor:pointer"
            >
              <div :style="{width:'40px',height:'23px',borderRadius:'999px',flex:'none',background: quickMode?'var(--primary)':'var(--border-strong)',position:'relative',transition:'background .18s'}">
                <div :style="{position:'absolute',top:'2.5px',left: quickMode?'19px':'2.5px',width:'18px',height:'18px',borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.35)',transition:'left .18s'}"></div>
              </div>
              <div style="flex:1">
                <div style="font-size:13.5px;font-weight:600">{{ t.quickMode }}</div>
                <div style="font-size:12px;color:var(--text-2)">{{ t.quickHint }}</div>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:16px 22px;border-top:1px solid var(--border);background:var(--surface-2)">
            <div style="font-size:12.5px;color:var(--text-2)">{{ isValid ? t.runHintReady : t.runHintBlocked }}</div>
            <button
              @click="runAnalysis"
              :disabled="runBlocked"
              :style="{display:'inline-flex',alignItems:'center',gap:'9px',fontSize:'14px',fontWeight:'600',padding:'11px 20px',borderRadius:'10px',border:'none',transition:'opacity .15s',color: runBlocked?'var(--text-3)':'var(--on-primary)',background: runBlocked?'var(--surface-3)':'var(--primary)',cursor: runBlocked?'not-allowed':'pointer',boxShadow: runBlocked?'none':'var(--shadow)'}"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex:none"><path d="M8 5v14l11-7z"/></svg>
              {{ t.run }}
            </button>
          </div>
        </div>
      </section>

      <!-- STEP 3 · PROGRESS -->
      <section
        v-if="running !== 'no'"
        style="background:var(--surface);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow);padding:22px;margin-top:22px;animation:epr-fade .25s ease"
      >
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:11px">
            <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:var(--text-3);letter-spacing:.05em">{{ t.stepLabel }} 3</span>
            <h2 style="margin:0;font-size:17px;font-weight:600;letter-spacing:-.01em">{{ running === 'done' ? t.done : t.analyzing }}</h2>
          </div>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:600;color:var(--primary)">{{ Math.round(progress) }}%</span>
        </div>

        <div v-if="running === 'analyzing'" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:13px;color:var(--text-2)">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--primary);animation:epr-pulse 1s ease-in-out infinite;flex:none"></span>
          <span style="font-weight:600;color:var(--text)">{{ phase==='warmup' ? t.phaseWarmup : t.phaseSampling }}</span>
          <span>· {{ phase==='warmup' ? t.phaseWarmupSub : t.phaseSamplingSub }}</span>
        </div>

        <div style="height:10px;border-radius:999px;background:var(--surface-3);overflow:hidden">
          <div :style="{height:'100%',borderRadius:'999px',background:'linear-gradient(90deg,var(--primary),var(--green))',width: progress+'%',transition:'width .12s linear'}"></div>
        </div>

        <div v-if="running === 'done' && diagnostics" style="margin-top:18px;padding:16px;border:1px solid var(--border);border-radius:13px;background:var(--surface-2)">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px">{{ t.diagTitle }}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;font-size:12.5px">
            <div>
              <div style="color:var(--text-3);margin-bottom:2px">{{ t.diagConverge }}</div>
              <div :style="{fontWeight:'600',color: diagnostics.converged?'var(--green-fg)':'var(--amber-fg)'}">
                {{ diagnostics.converged ? '✓ ' + t.diagConvergeVal : '⚠ ' + t.diagConvergeBadVal }}
              </div>
            </div>
            <div>
              <div style="color:var(--text-3);margin-bottom:2px">{{ t.diagRhat }}</div>
              <div style="font-weight:600;font-family:'IBM Plex Mono',monospace">{{ diagnostics.rHatMax.toFixed(3) }}</div>
            </div>
            <div>
              <div style="color:var(--text-3);margin-bottom:2px">{{ t.diagDiv }}</div>
              <div style="font-weight:600;font-family:'IBM Plex Mono',monospace">{{ diagnostics.divergences }}</div>
            </div>
            <div>
              <div style="color:var(--text-3);margin-bottom:2px">{{ t.diagRuntime }}</div>
              <div style="font-weight:600;font-family:'IBM Plex Mono',monospace">{{ runtimeText }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- RESULTS -->
      <section v-if="running === 'done' && outputTables" style="margin-top:22px;animation:epr-fade .3s ease">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px">
          <div style="display:flex;align-items:baseline;gap:11px">
            <h2 style="margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em">{{ t.resultsTitle }}</h2>
            <span style="font-size:13px;color:var(--text-2)">{{ t.resultsSub }}</span>
          </div>
          <button
            @click="downloadResults"
            style="display:inline-flex;align-items:center;gap:9px;font-size:14px;font-weight:600;color:var(--on-primary);background:var(--primary);border:none;padding:11px 18px;border-radius:10px;cursor:pointer;box-shadow:var(--shadow)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
            {{ t.downloadResults }}
          </button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px">
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)">
              <h3 style="margin:0;font-size:15px;font-weight:600">{{ t.participants }}</h3>
              <span style="font-size:11.5px;color:var(--text-3);font-family:'IBM Plex Mono',monospace">n = {{ outputTables.participants.length }}</span>
            </div>
            <div style="overflow-x:auto;max-height:420px">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="text-align:left;color:var(--text-3);font-size:11px;letter-spacing:.04em;text-transform:uppercase;position:sticky;top:0;background:var(--surface)">
                    <th style="padding:9px 18px;font-weight:600">{{ t.colId }}</th>
                    <th style="padding:9px 12px;font-weight:600">{{ t.colReliability }}</th>
                    <th style="padding:9px 18px;font-weight:600;text-align:right">{{ t.colConfidence }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(p, i) in outputTables.participants" :key="i" style="border-top:1px solid var(--border)">
                    <td style="padding:11px 18px;font-family:'IBM Plex Mono',monospace;font-weight:500">{{ p.id }}</td>
                    <td style="padding:11px 12px">
                      <span v-if="p.reliability==='HIGH'" style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--green-fg);background:var(--green-tint);border:1px solid color-mix(in srgb,var(--green) 30%,transparent);padding:3px 9px;border-radius:999px"><span style="width:7px;height:7px;border-radius:50%;background:var(--green)"></span>{{ t.high }}</span>
                      <span v-else-if="p.reliability==='MEDIUM'" style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--amber-fg);background:var(--amber-tint);border:1px solid color-mix(in srgb,var(--amber) 38%,transparent);padding:3px 9px;border-radius:999px"><span style="width:7px;height:7px;border-radius:50%;background:var(--amber)"></span>{{ t.medium }}</span>
                      <span v-else style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--red-fg);background:var(--red-tint);border:1px solid color-mix(in srgb,var(--red) 40%,transparent);padding:3px 9px;border-radius:999px"><span style="width:7px;height:7px;border-radius:50%;background:var(--red)"></span>{{ t.low }}</span>
                    </td>
                    <td style="padding:11px 18px">
                      <div style="display:flex;align-items:center;gap:9px;justify-content:flex-end">
                        <div style="width:52px;height:5px;border-radius:999px;background:var(--surface-3);overflow:hidden;flex:none"><div :style="{height:'100%',background:'var(--text-3)',width: Math.round(p.confidence*100)+'%'}"></div></div>
                        <span style="font-family:'IBM Plex Mono',monospace;font-weight:500;min-width:36px;text-align:right">{{ p.confidence.toFixed(2) }}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow);overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--border)">
              <h3 style="margin:0;font-size:15px;font-weight:600">{{ t.questionnaires }}</h3>
              <span style="font-size:11.5px;color:var(--text-3);font-family:'IBM Plex Mono',monospace">n = {{ outputTables.questionnaires.length }}</span>
            </div>
            <div style="overflow-x:auto;max-height:420px">
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                  <tr style="text-align:left;color:var(--text-3);font-size:11px;letter-spacing:.04em;text-transform:uppercase;position:sticky;top:0;background:var(--surface)">
                    <th style="padding:9px 18px;font-weight:600">{{ t.colId }}</th>
                    <th style="padding:9px 12px;font-weight:600">{{ t.colAnomaly }}</th>
                    <th style="padding:9px 18px;font-weight:600;text-align:right">{{ t.colConfidence }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(q, i) in outputTables.questionnaires" :key="i" style="border-top:1px solid var(--border)">
                    <td style="padding:11px 18px;font-family:'IBM Plex Mono',monospace;font-weight:500">{{ q.id }}</td>
                    <td style="padding:11px 12px">
                      <span v-if="q.anomaly" style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--red-fg);background:var(--red-tint);border:1px solid color-mix(in srgb,var(--red) 40%,transparent);padding:3px 9px;border-radius:999px"><span style="width:7px;height:7px;border-radius:50%;background:var(--red)"></span>{{ t.anomYes }}</span>
                      <span v-else style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--green-fg);background:var(--green-tint);border:1px solid color-mix(in srgb,var(--green) 30%,transparent);padding:3px 9px;border-radius:999px"><span style="width:7px;height:7px;border-radius:50%;background:var(--green)"></span>{{ t.anomNo }}</span>
                    </td>
                    <td style="padding:11px 18px">
                      <div style="display:flex;align-items:center;gap:9px;justify-content:flex-end">
                        <div style="width:52px;height:5px;border-radius:999px;background:var(--surface-3);overflow:hidden;flex:none"><div :style="{height:'100%',background:'var(--text-3)',width: Math.round(q.confidence*100)+'%'}"></div></div>
                        <span style="font-family:'IBM Plex Mono',monospace;font-weight:500;min-width:36px;text-align:right">{{ q.confidence.toFixed(2) }}</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- LEGEND -->
      <section v-if="outputTables" style="margin-top:22px;padding:18px 22px;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow)">
        <div style="font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3);margin-bottom:13px">{{ t.legendTitle }}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          <div style="display:flex;align-items:center;gap:10px"><span style="width:11px;height:11px;border-radius:50%;background:var(--green);flex:none;box-shadow:0 0 0 3px var(--green-tint)"></span><span style="font-size:12.5px"><b style="font-weight:600">{{ t.high }}</b> · {{ t.legHigh }}</span></div>
          <div style="display:flex;align-items:center;gap:10px"><span style="width:11px;height:11px;border-radius:50%;background:var(--amber);flex:none;box-shadow:0 0 0 3px var(--amber-tint)"></span><span style="font-size:12.5px"><b style="font-weight:600">{{ t.medium }}</b> · {{ t.legMed }}</span></div>
          <div style="display:flex;align-items:center;gap:10px"><span style="width:11px;height:11px;border-radius:50%;background:var(--red);flex:none;box-shadow:0 0 0 3px var(--red-tint)"></span><span style="font-size:12.5px"><b style="font-weight:600">{{ t.low }}</b> · {{ t.legLow }}</span></div>
          <div style="display:flex;align-items:center;gap:10px"><span style="width:11px;height:11px;border-radius:50%;background:var(--red);flex:none;box-shadow:0 0 0 3px var(--red-tint)"></span><span style="font-size:12.5px"><b style="font-weight:600">{{ t.anomYes }}</b> · {{ t.legAnomYes }}</span></div>
          <div style="display:flex;align-items:center;gap:10px"><span style="width:11px;height:11px;border-radius:50%;background:var(--green);flex:none;box-shadow:0 0 0 3px var(--green-tint)"></span><span style="font-size:12.5px"><b style="font-weight:600">{{ t.anomNo }}</b> · {{ t.legAnomNo }}</span></div>
          <div style="display:flex;align-items:center;gap:10px"><span style="width:11px;height:11px;border-radius:50%;background:var(--text-3);flex:none;box-shadow:0 0 0 3px var(--surface-3)"></span><span style="font-size:12.5px"><b style="font-weight:600">{{ t.legNeutralT }}</b> · {{ t.legNeutral }}</span></div>
        </div>
      </section>
    </main>

    <footer style="border-top:1px solid var(--border);background:var(--surface);margin-top:40px">
      <div style="max-width:1080px;margin:0 auto;padding:30px 28px;display:flex;flex-wrap:wrap;gap:34px;justify-content:space-between">
        <div style="max-width:52ch">
          <img :src="`${baseUrl}logo_tv.png`" alt="Università di Roma Tor Vergata" style="height:26px;width:auto;margin-bottom:14px;opacity:.9" />
          <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:8px">{{ t.authors }}</div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.7">Alessandro Checco · Lorenzo Bracciale · Giorgia Panico · Davide Rizzo · Francesco Bussu · Pierpaolo Loreti</div>
        </div>
        <div style="max-width:40ch">
          <div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);margin-bottom:8px">{{ t.acknowledgement }}</div>
          <p style="margin:0;font-size:13px;color:var(--text-2);line-height:1.6">{{ t.precisionThanks }} — <a href="https://www.precision-project.it/" target="_blank" rel="noopener">precision-project.it</a></p>
          <p style="margin:10px 0 0;font-size:11.5px;color:var(--text-3);line-height:1.6">{{ t.precisionFund }}</p>
        </div>
      </div>
    </footer>

    <div
      v-if="toast"
      style="position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;background:var(--text);color:var(--bg);font-size:13px;font-weight:500;padding:11px 18px;border-radius:11px;box-shadow:var(--shadow-lg);animation:epr-fade .2s ease"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      {{ toast }}
    </div>
  </div>
</template>
