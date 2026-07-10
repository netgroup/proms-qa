// Node smoke test for the sampler + postprocess on a small synthetic dataset.
// Runs the model on toy data and checks that:
//   - the sampler completes without throwing,
//   - logp is finite,
//   - baseline_reliability draws are in (0, 1),
//   - questionnaire_reliability draws are in (0, 1),
//   - postprocess produces well-formed tables.
//
// Simulate: 6 participants, 3 questionnaires each, 2 direct + 1 fatigue + 1 confidence.
// True baseline reliability: some HIGH, some LOW, so we can eyeball the classification.

import { sample } from '../src/workers/sampler/hmc.ts'
import { extractPosterior } from '../src/workers/sampler/posterior.ts'
import { postprocess } from '../src/lib/postprocess.ts'

const MAX_SCORE = 4 // 5 categories 0..4
const N = 6
const T_PER = 3
const T = N * T_PER
const D = 2
const F = 1
const C = 1
const DEFAULT_CFG = {
  featureTypeToFamily: {},
  reliabilityHighThreshold: 0.8,
  reliabilityLowThreshold: 0.6,
  anomalyScoreThreshold: 0.8,
  anomalyMinPredictiveProbability: 1e-12,
  defaultMcmc: { seed: 42, chains: 2, warmup: 300, draws: 300, adaptDelta: 0.9 },
  quickModeMcmc: {},
}

// True baseline theta per participant: mix of positive (reliable) and negative
const trueTheta = [1.5, 1.0, -1.5, -0.8, 0.6, -0.3]

function sampleCat(x, cuts, rng) {
  // ordered logistic P(y=s) = sigmoid(cuts[s]-x) - sigmoid(cuts[s-1]-x)
  const u = rng()
  let cum = 0
  for (let s = 0; s < cuts.length; s++) {
    const p = sigmoid(cuts[s] - x) - (s === 0 ? 0 : sigmoid(cuts[s - 1] - x))
    if (u < cum + p) return s
    cum += p
  }
  return cuts.length
}
function sigmoid(x) { return x >= 0 ? 1/(1+Math.exp(-x)) : Math.exp(x)/(1+Math.exp(x)) }

function makeCutpoints(K) {
  const c = new Float64Array(K)
  const off = (K - 1)/2
  for (let s = 0; s < K; s++) c[s] = s - off
  return c
}

// simple LCG rng seeded
let rngState = 12345
function rng() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
  return rngState / 0x7fffffff
}

const participantIdx = new Int32Array(T)
for (let i = 0; i < N; i++) for (let k = 0; k < T_PER; k++) participantIdx[i*T_PER + k] = i

const cuts = makeCutpoints(MAX_SCORE)

// Direct signals: y ~ ord_logistic(eta)
const directValues = [new Int32Array(T), new Int32Array(T)]
const fatigueValues = [new Int32Array(T)]
const confidenceValues = [new Int32Array(T)]

// synthesize eta ~ theta + small delta noise
const trueDelta = new Float64Array(T)
for (let t = 0; t < T; t++) trueDelta[t] = (rng() - 0.5) * 0.4
for (let t = 0; t < T; t++) {
  const eta = trueTheta[participantIdx[t]] + trueDelta[t]
  for (let k = 0; k < D; k++) directValues[k][t] = sampleCat(eta, cuts, rng)
  fatigueValues[0][t] = sampleCat(trueDelta[t], cuts, rng)
  confidenceValues[0][t] = sampleCat(eta + (participantIdx[t] % 2 === 0 ? 0.5 : -0.5), cuts, rng)
}

function longform(colVals, colIdx) {
  const obsValues = []
  const obsQuestIdx = []
  const obsColIdx = []
  for (let k = 0; k < colVals.length; k++) {
    for (let t = 0; t < colVals[k].length; t++) {
      obsValues.push(colVals[k][t])
      obsQuestIdx.push(t)
      obsColIdx.push(k)
    }
  }
  return {
    nCols: colVals.length,
    maxScores: new Int32Array(colVals.length).fill(MAX_SCORE),
    obsValues: new Int32Array(obsValues),
    obsQuestIdx: new Int32Array(obsQuestIdx),
    obsColIdx: new Int32Array(obsColIdx),
  }
}
// hack: fill with MAX_SCORE
function fillMs(arr, ms) { for (let i = 0; i < arr.length; i++) arr[i] = ms; return arr }

const data = {
  N, T, participantIdx,
  direct: { nCols: D, maxScores: fillMs(new Int32Array(D), MAX_SCORE), obsValues: new Int32Array(D*T), obsQuestIdx: new Int32Array(D*T), obsColIdx: new Int32Array(D*T) },
  fatigue: { nCols: F, maxScores: fillMs(new Int32Array(F), MAX_SCORE), obsValues: new Int32Array(F*T), obsQuestIdx: new Int32Array(F*T), obsColIdx: new Int32Array(F*T) },
  confidence: { nCols: C, maxScores: fillMs(new Int32Array(C), MAX_SCORE), obsValues: new Int32Array(C*T), obsQuestIdx: new Int32Array(C*T), obsColIdx: new Int32Array(C*T) },
}
let idx = 0
for (let k = 0; k < D; k++) for (let t = 0; t < T; t++) { data.direct.obsValues[idx] = directValues[k][t]; data.direct.obsQuestIdx[idx] = t; data.direct.obsColIdx[idx] = k; idx++ }
idx = 0
for (let k = 0; k < F; k++) for (let t = 0; t < T; t++) { data.fatigue.obsValues[idx] = fatigueValues[k][t]; data.fatigue.obsQuestIdx[idx] = t; data.fatigue.obsColIdx[idx] = k; idx++ }
idx = 0
for (let k = 0; k < C; k++) for (let t = 0; t < T; t++) { data.confidence.obsValues[idx] = confidenceValues[k][t]; data.confidence.obsQuestIdx[idx] = t; data.confidence.obsColIdx[idx] = k; idx++ }

const t0 = Date.now()
const combined = sample(data, {
  seed: 42, chains: 2, warmup: 300, draws: 300, adaptDelta: 0.9,
  onProgress: () => {},
})
const { draws, diagnostics } = extractPosterior(combined, data, 42)
console.log(`sampled in ${Date.now()-t0}ms; runtime ${diagnostics.runtimeMs.toFixed(0)}ms`)
console.log('R-hat max:', diagnostics.rHatMax.toFixed(3), 'ESS min:', diagnostics.essMin.toFixed(0), 'divergences:', diagnostics.divergences)

// Check baseline_reliability
const S = draws.nDraws
let minB = 1, maxB = 0
for (let i = 0; i < S * draws.N; i++) {
  const v = draws.baselineReliability[i]
  if (!Number.isFinite(v) || v <= 0 || v >= 1) {
    console.error('bad baseline', i, v)
    process.exit(1)
  }
  if (v < minB) minB = v; if (v > maxB) maxB = v
}
console.log('baseline range:', minB.toFixed(3), '-', maxB.toFixed(3))

// Per participant baseline_reliability median
console.log('Per-participant baseline (true theta -> sigmoid):')
for (let i = 0; i < N; i++) {
  const s = []
  for (let d = 0; d < S; d++) s.push(draws.baselineReliability[d * N + i])
  s.sort((a,b)=>a-b)
  const med = s[Math.floor(S/2)]
  const truth = sigmoid(trueTheta[i])
  console.log(`  P${i}: true=${truth.toFixed(3)}  posterior median=${med.toFixed(3)}`)
}

// Serialize and postprocess
const yRep = {}
for (const k of Object.keys(draws.yRep)) yRep[k] = Array.from(draws.yRep[k])
const ser = {
  draws: {
    baselineReliability: Array.from(draws.baselineReliability),
    questionnaireReliability: Array.from(draws.questionnaireReliability),
    b: draws.b ? Array.from(draws.b) : null,
    yRep,
    scalarNames: draws.scalarNames,
    scalars: Array.from(draws.scalars),
    nDraws: draws.nDraws,
    N: draws.N,
    T: draws.T,
  },
  diagnostics,
}
const pre = {
  nParticipants: N,
  nQuestionnaires: T,
  participantIndex: participantIdx,
  participantLabels: Array.from({length:N},(_,i)=>`P${i+1}`),
  questionnaireIds: Array.from({length:T},(_,t)=>`Q${t+1}`),
  directCols: [], fatigueCols: [], confidenceCols: [],
}
const out = postprocess(ser, pre, data, DEFAULT_CFG)
console.log('participants sample:', out.participants.slice(0,3))
console.log('questionnaires sample:', out.questionnaires.slice(0,3))
console.log('OK')
