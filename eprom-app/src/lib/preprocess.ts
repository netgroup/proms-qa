import type {
  AppConfig,
  Family,
  ParsedWorkbook,
  PreprocessedData,
  SignalColumn,
  StanData,
  FamilyData,
} from './types'
import { normKey } from './xlsx-io'

const RESERVED = new Set(['questionnaire_id', 'participant_id'])

interface MapRow {
  columnName: string
  featureType: string
  min: number | null
  max: number | null
}

function buildMapIndex(wb: ParsedWorkbook): Map<string, MapRow> {
  const idxCol = wb.maps.headerMap.get('column name')!
  const idxFt = wb.maps.headerMap.get('featuretype')!
  const idxMin = wb.maps.headerMap.get('minimum value') ?? wb.maps.headerMap.get('min')
  const idxMax = wb.maps.headerMap.get('maximum value') ?? wb.maps.headerMap.get('max')
  const out = new Map<string, MapRow>()
  for (const r of wb.maps.rows) {
    const name = r[idxCol] == null ? '' : String(r[idxCol]).trim()
    if (!name) continue
    const ft = r[idxFt] == null ? '' : String(r[idxFt]).trim()
    const minV = idxMin !== undefined ? r[idxMin] : null
    const maxV = idxMax !== undefined ? r[idxMax] : null
    const min = minV != null && minV !== '' && Number.isFinite(Number(minV)) ? Number(minV) : null
    const max = maxV != null && maxV !== '' && Number.isFinite(Number(maxV)) ? Number(maxV) : null
    out.set(normKey(name), { columnName: name, featureType: ft, min, max })
  }
  return out
}

function resolveFamily(config: AppConfig, featureType: string): Family | null {
  // exact match first, then case-insensitive trim
  if (config.featureTypeToFamily[featureType]) return config.featureTypeToFamily[featureType]
  const key = normKey(featureType)
  for (const [ft, fam] of Object.entries(config.featureTypeToFamily)) {
    if (normKey(ft) === key) return fam
  }
  return null
}

export function preprocess(wb: ParsedWorkbook, config: AppConfig): PreprocessedData {
  const qCol = wb.input.headerMap.get('questionnaire_id')!
  const pCol = wb.input.headerMap.get('participant_id')!

  const questionnaireIds: string[] = wb.input.rows.map((r) =>
    r[qCol] == null ? '' : String(r[qCol]),
  )

  // Factorize participant ids (order of appearance)
  const participantLabels: string[] = []
  const labelToIdx = new Map<string, number>()
  const participantIndex = new Int32Array(wb.input.rows.length)
  wb.input.rows.forEach((r, i) => {
    const raw = r[pCol]
    const key = raw == null ? '' : String(raw)
    let idx = labelToIdx.get(key)
    if (idx === undefined) {
      idx = participantLabels.length
      labelToIdx.set(key, idx)
      participantLabels.push(key)
    }
    participantIndex[i] = idx
  })

  const mapIdx = buildMapIndex(wb)

  const direct: SignalColumn[] = []
  const fatigue: SignalColumn[] = []
  const confidence: SignalColumn[] = []

  wb.input.headers.forEach((h, colIdx) => {
    if (!h) return
    if (RESERVED.has(normKey(h))) return
    const m = mapIdx.get(normKey(h))
    if (!m) return
    const fam = resolveFamily(config, m.featureType)
    if (!fam) return

    const values = new Float64Array(wb.input.rows.length)
    let observedMin: number | null = null
    let observedMax: number | null = null
    let anyValue = false
    const rawInts: (number | null)[] = new Array(wb.input.rows.length)
    for (let i = 0; i < wb.input.rows.length; i++) {
      const v = wb.input.rows[i][colIdx]
      if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
        rawInts[i] = null
        values[i] = Number.NaN
        continue
      }
      const n = Math.round(Number(v))
      rawInts[i] = n
      anyValue = true
      observedMin = observedMin === null ? n : Math.min(observedMin, n)
      observedMax = observedMax === null ? n : Math.max(observedMax, n)
    }
    if (!anyValue) return // W2: skip empty column

    let minVal: number
    if (m.min !== null) minVal = m.min
    else if (observedMin !== null && observedMin > 0) minVal = observedMin
    else minVal = 0

    const maxVal = m.max !== null ? m.max : (observedMax ?? (minVal + 1))
    const maxScore = maxVal - minVal
    if (maxScore < 1) return

    for (let i = 0; i < rawInts.length; i++) {
      const n = rawInts[i]
      values[i] = n === null ? Number.NaN : n - minVal
    }

    const sc: SignalColumn = {
      name: h,
      family: fam,
      featureType: m.featureType,
      values,
      maxScore,
      min: minVal,
      max: maxVal,
    }
    if (fam === 'direct') direct.push(sc)
    else if (fam === 'fatigue') fatigue.push(sc)
    else confidence.push(sc)
  })

  return {
    nParticipants: participantLabels.length,
    nQuestionnaires: wb.input.rows.length,
    participantIndex,
    participantLabels,
    questionnaireIds,
    directCols: direct,
    fatigueCols: fatigue,
    confidenceCols: confidence,
  }
}

function buildFamilyLong(cols: SignalColumn[], nQ: number): FamilyData {
  const nCols = cols.length
  const maxScores = new Int32Array(nCols)
  const obsValues: number[] = []
  const obsQuestIdx: number[] = []
  const obsColIdx: number[] = []
  for (let c = 0; c < nCols; c++) {
    maxScores[c] = cols[c].maxScore
    const vals = cols[c].values
    for (let t = 0; t < nQ; t++) {
      const v = vals[t]
      if (!Number.isNaN(v)) {
        obsValues.push(v)
        obsQuestIdx.push(t)
        obsColIdx.push(c)
      }
    }
  }
  return {
    nCols,
    maxScores,
    obsValues: new Int32Array(obsValues),
    obsQuestIdx: new Int32Array(obsQuestIdx),
    obsColIdx: new Int32Array(obsColIdx),
  }
}

export function toStanData(pre: PreprocessedData): StanData {
  return {
    N: pre.nParticipants,
    T: pre.nQuestionnaires,
    participantIdx: pre.participantIndex,
    direct: buildFamilyLong(pre.directCols, pre.nQuestionnaires),
    fatigue: buildFamilyLong(pre.fatigueCols, pre.nQuestionnaires),
    confidence: buildFamilyLong(pre.confidenceCols, pre.nQuestionnaires),
  }
}

export function fixedCutpoints(maxScore: number): Float64Array {
  const c = new Float64Array(maxScore)
  const offset = (maxScore - 1) / 2
  for (let s = 0; s < maxScore; s++) c[s] = s - offset
  return c
}
