// End-to-end pipeline test: build a workbook in-memory, run parse → validate → preprocess → sample → postprocess.
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { parseWorkbook } from '../src/lib/xlsx-io.ts'
import { validateWorkbook } from '../src/lib/validate.ts'
import { preprocess, toStanData } from '../src/lib/preprocess.ts'
import { sample } from '../src/workers/sampler/hmc.ts'
import { extractPosterior, serializePosterior } from '../src/workers/sampler/posterior.ts'
import { postprocess } from '../src/lib/postprocess.ts'

const config = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url)))

async function buildWb() {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('README')

  const inp = wb.addWorksheet('INPUT')
  inp.addRow(['Questionnaire_ID','Participant_ID','q_direct','q_direct2','q_fatigue','q_conf'])
  // 6 participants x 4 questionnaires
  const N = 6, T_PER = 4
  const trueTheta = [1.6, 0.9, -1.4, -0.5, 0.4, -0.9]
  function sigmoid(x){ return x>=0 ? 1/(1+Math.exp(-x)) : Math.exp(x)/(1+Math.exp(x)) }
  const cuts = [-2,-1,0,1,2]
  let rs = 999
  const rng = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff }
  function sampleCat(x) {
    const u = rng()
    let cum = 0
    for (let s = 0; s < cuts.length; s++) {
      const p = sigmoid(cuts[s]-x) - (s===0?0:sigmoid(cuts[s-1]-x))
      if (u < cum + p) return s
      cum += p
    }
    return 5
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < T_PER; k++) {
      const delta = (rng()-0.5)*0.3
      const eta = trueTheta[i] + delta
      inp.addRow([`Q${i}_${k}`, `P${i+1}`,
        sampleCat(eta), sampleCat(eta),
        sampleCat(delta),
        sampleCat(eta + (i%2===0?0.4:-0.4)),
      ])
    }
  }

  const maps = wb.addWorksheet('MAPS')
  maps.addRow(['Column Name','FeatureType','MIN','MAX'])
  maps.addRow(['q_direct','Gold Standard Questions',0,5])
  maps.addRow(['q_direct2','Counterfactual Questions',0,5])
  maps.addRow(['q_fatigue','Attention Checks',0,5])
  maps.addRow(['q_conf','Self-Reported Confidence',0,5])

  const cfg = wb.addWorksheet('CONFIG')
  cfg.addRow(['Categorie (non toccare)'])
  for (const k of Object.keys(config.featureTypeToFamily)) cfg.addRow([k])

  return wb.xlsx.writeBuffer()
}

const buf = await buildWb()
const parsed = await parseWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength))
console.log('parsed sheets:', parsed.sheetNames, 'input rows:', parsed.input.rows.length, 'maps rows:', parsed.maps.rows.length, 'config:', parsed.config.length)

const val = validateWorkbook(parsed, config)
console.log('validation issues:', val.issues.length, 'hasErrors:', val.hasErrors)
for (const i of val.issues) console.log(' ', i.severity, i.code, i.message)

if (val.hasErrors) process.exit(1)

const pre = preprocess(parsed, config)
console.log(`preprocess: N=${pre.nParticipants} T=${pre.nQuestionnaires} D=${pre.directCols.length} F=${pre.fatigueCols.length} C=${pre.confidenceCols.length}`)

const data = toStanData(pre)
const combined = sample(data, { seed: 7, chains: 2, warmup: 300, draws: 300, adaptDelta: 0.9, onProgress: () => {} })
const { draws, diagnostics } = extractPosterior(combined, data, 7)
console.log(`sampling done: rhat=${diagnostics.rHatMax.toFixed(3)} ess=${diagnostics.essMin.toFixed(0)} div=${diagnostics.divergences}`)

const ser = serializePosterior(draws, diagnostics)
const out = postprocess(ser, pre, data, config)
console.log('participants:')
for (const p of out.participants) console.log(` ${p.id}: ${p.reliability} (conf=${p.confidence.toFixed(3)})`)
console.log('questionnaires (first 6):')
for (const q of out.questionnaires.slice(0, 6)) console.log(` ${q.id}: anomaly=${q.anomaly} conf=${q.confidence.toFixed(3)}`)
console.log('END')
