import type {
  AppConfig,
  ParticipantRow,
  PreprocessedData,
  QuestionnaireRow,
  SerializedSamplerResult,
  StanData,
  OutputTables,
} from './types'

interface DesReliability {
  label: 'HIGH' | 'MEDIUM' | 'LOW'
  confidence: number
}

function classifyReliability(
  samples: number[],
  hi: number,
  lo: number,
): DesReliability {
  const n = samples.length
  const sorted = samples.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(n / 2)]
  if (median > hi) {
    let c = 0
    for (const v of samples) if (v > hi) c++
    return { label: 'HIGH', confidence: c / n }
  }
  if (median < lo) {
    let c = 0
    for (const v of samples) if (v < lo) c++
    return { label: 'LOW', confidence: c / n }
  }
  let c = 0
  for (const v of samples) if (v >= lo && v <= hi) c++
  return { label: 'MEDIUM', confidence: c / n }
}

interface FamilySeq {
  name: 'direct' | 'fatigue' | 'confidence'
  yRep: number[]
  obsValues: Int32Array
  obsQuestIdx: Int32Array
  obsColIdx: Int32Array
  maxScores: Int32Array
}

function accumulateFamily(
  seq: FamilySeq,
  nDraws: number,
  T: number,
  minP: number,
  observedSurprisalSum: Float64Array,
  replicatedSurprisalSum: Float64Array, // shape (nDraws, T), row-major
  observedSignalCount: Int32Array,
): void {
  const nObs = seq.obsValues.length
  if (nObs === 0) return

  // For each column (unique obsColIdx), compute per-observation category probabilities
  // from yRep across draws, then update surprisal sums.
  // Group observations by column.
  const byCol = new Map<number, number[]>()
  for (let o = 0; o < nObs; o++) {
    const k = seq.obsColIdx[o]
    let list = byCol.get(k)
    if (!list) {
      list = []
      byCol.set(k, list)
    }
    list.push(o)
  }

  for (const [k, obsIdxList] of byCol) {
    const maxScore = seq.maxScores[k]
    const K = maxScore + 1
    // Count freq of each category per observation across draws
    const nCol = obsIdxList.length
    // freq[o_in_col * K + s]
    const freq = new Int32Array(nCol * K)
    for (let d = 0; d < nDraws; d++) {
      const rowBase = d * nObs
      for (let j = 0; j < nCol; j++) {
        const o = obsIdxList[j]
        const cat = seq.yRep[rowBase + o]
        if (cat >= 0 && cat < K) freq[j * K + cat]++
      }
    }
    // category_probabilities[o, s] = freq[o,s]/nDraws
    for (let j = 0; j < nCol; j++) {
      const o = obsIdxList[j]
      const t = seq.obsQuestIdx[o]
      const obsCat = seq.obsValues[o]
      const pObs = Math.max(minP, freq[j * K + obsCat] / nDraws)
      observedSurprisalSum[t] += -Math.log(pObs)
      observedSignalCount[t] += 1
      // Per-draw replicated surprisal:
      for (let d = 0; d < nDraws; d++) {
        const cat = seq.yRep[d * nObs + o]
        const p = Math.max(minP, freq[j * K + cat] / nDraws)
        replicatedSurprisalSum[d * T + t] += -Math.log(p)
      }
    }
  }
}

export function postprocess(
  result: SerializedSamplerResult,
  pre: PreprocessedData,
  data: StanData,
  config: AppConfig,
): OutputTables {
  const draws = result.draws
  const S = draws.nDraws
  const N = draws.N
  const T = draws.T

  // Participants
  const participants: ParticipantRow[] = []
  for (let i = 0; i < N; i++) {
    const samples: number[] = new Array(S)
    for (let s = 0; s < S; s++) samples[s] = draws.baselineReliability[s * N + i]
    const cls = classifyReliability(samples, config.reliabilityHighThreshold, config.reliabilityLowThreshold)
    participants.push({
      id: pre.participantLabels[i] ?? `P${i + 1}`,
      reliability: cls.label,
      confidence: cls.confidence,
    })
  }

  // Questionnaires: anomaly via posterior-predictive tail area
  const observedSurprisalSum = new Float64Array(T)
  const replicatedSurprisalSum = new Float64Array(S * T)
  const observedSignalCount = new Int32Array(T)
  const minP = config.anomalyMinPredictiveProbability

  accumulateFamily(
    {
      name: 'direct',
      yRep: draws.yRep['direct'] ?? [],
      obsValues: data.direct.obsValues,
      obsQuestIdx: data.direct.obsQuestIdx,
      obsColIdx: data.direct.obsColIdx,
      maxScores: data.direct.maxScores,
    },
    S,
    T,
    minP,
    observedSurprisalSum,
    replicatedSurprisalSum,
    observedSignalCount,
  )
  accumulateFamily(
    {
      name: 'fatigue',
      yRep: draws.yRep['fatigue'] ?? [],
      obsValues: data.fatigue.obsValues,
      obsQuestIdx: data.fatigue.obsQuestIdx,
      obsColIdx: data.fatigue.obsColIdx,
      maxScores: data.fatigue.maxScores,
    },
    S,
    T,
    minP,
    observedSurprisalSum,
    replicatedSurprisalSum,
    observedSignalCount,
  )
  accumulateFamily(
    {
      name: 'confidence',
      yRep: draws.yRep['confidence'] ?? [],
      obsValues: data.confidence.obsValues,
      obsQuestIdx: data.confidence.obsQuestIdx,
      obsColIdx: data.confidence.obsColIdx,
      maxScores: data.confidence.maxScores,
    },
    S,
    T,
    minP,
    observedSurprisalSum,
    replicatedSurprisalSum,
    observedSignalCount,
  )

  // Mean over signals per questionnaire
  const meanObsSurprisal = new Float64Array(T)
  for (let t = 0; t < T; t++) {
    const c = observedSignalCount[t]
    meanObsSurprisal[t] = c > 0 ? observedSurprisalSum[t] / c : 0
  }
  const meanRepSurprisal = new Float64Array(S * T)
  for (let s = 0; s < S; s++) {
    for (let t = 0; t < T; t++) {
      const c = observedSignalCount[t]
      meanRepSurprisal[s * T + t] = c > 0 ? replicatedSurprisalSum[s * T + t] / c : 0
    }
  }

  const questionnaires: QuestionnaireRow[] = []
  const anomalyThreshold = config.anomalyScoreThreshold
  for (let t = 0; t < T; t++) {
    if (observedSignalCount[t] === 0) {
      questionnaires.push({
        id: pre.questionnaireIds[t] || `Q${t + 1}`,
        anomaly: false,
        confidence: 0,
      })
      continue
    }
    let ge = 0
    for (let s = 0; s < S; s++) {
      if (meanRepSurprisal[s * T + t] >= meanObsSurprisal[t]) ge++
    }
    const tailArea = ge / S
    const anomalyScore = 1 - tailArea
    questionnaires.push({
      id: pre.questionnaireIds[t] || `Q${t + 1}`,
      anomaly: anomalyScore >= anomalyThreshold,
      confidence: anomalyScore,
    })
  }

  return { participants, questionnaires }
}
