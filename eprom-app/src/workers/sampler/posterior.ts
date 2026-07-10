// From raw draws (unconstrained params), compute posterior quantities:
// - baseline_reliability[i] = sigmoid(theta[i])
// - questionnaire_reliability[t] = sigmoid(eta[t])
// - b[i]
// - y_rep for each observation (posterior predictive), stored per family per column
// Also computes scalars (sigma_theta, sigma_delta, mu_f, mu_c, sigma_b).

import type { StanData, PosteriorDraws, Diagnostics, SerializedSamplerResult } from '../../lib/types'
import type { CombinedDraws } from './hmc'
import { fixedCutpoints } from '../../lib/preprocess'
import { RNG } from './rng'
import { splitRhat, ess } from './diagnostics'

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x))
  const e = Math.exp(x)
  return e / (1 + e)
}

function sampleOrderedLogistic(x: number, cuts: Float64Array, rng: RNG): number {
  // categories 0..cuts.length
  // P(y=0) = sigmoid(cuts[0]-x); cumulative
  const u = rng.next()
  let cum = 0
  for (let s = 0; s < cuts.length; s++) {
    const p = sigmoid(cuts[s] - x) - cum
    if (u < cum + p) return s
    cum += p
  }
  return cuts.length
}

export function extractPosterior(
  combined: CombinedDraws,
  data: StanData,
  seed: number,
): { draws: PosteriorDraws; diagnostics: Diagnostics } {
  const { layout, chains } = combined
  const nDrawsPerChain = combined.nDrawsPerChain
  const S = nDrawsPerChain * chains.length
  const N = layout.N
  const T = layout.T

  const rng = new RNG(seed + 1)
  const cutsDirect = Array.from({ length: layout.D }, (_, k) => fixedCutpoints(data.direct.maxScores[k]))
  const cutsFatigue = Array.from({ length: layout.F }, (_, k) => fixedCutpoints(data.fatigue.maxScores[k]))
  const cutsConfidence = Array.from({ length: layout.C }, (_, k) => fixedCutpoints(data.confidence.maxScores[k]))

  const baseline = new Float64Array(S * N)
  const qRel = new Float64Array(S * T)
  const bDraws = layout.C > 0 ? new Float64Array(S * N) : null

  // yRep per family stored as one big Int32Array per family, layout (S, nObs)
  const yRep: Record<string, Int32Array> = {}
  const yRepDirect = new Int32Array(S * data.direct.obsValues.length)
  const yRepFatigue = new Int32Array(S * data.fatigue.obsValues.length)
  const yRepConfidence = new Int32Array(S * data.confidence.obsValues.length)

  const scalarNames: string[] = ['sigma_theta', 'sigma_delta']
  if (layout.F > 0) scalarNames.push('mu_f')
  if (layout.C > 0) {
    scalarNames.push('mu_c')
    scalarNames.push('sigma_b')
  }
  const scalars = new Float64Array(S * scalarNames.length)

  // For diagnostics: gather scalar chains for R-hat/ESS
  const scalarByChain: Float64Array[][] = scalarNames.map(() => [])

  let divergences = 0

  for (let c = 0; c < chains.length; c++) {
    const ch = chains[c]
    divergences += ch.divergences
    const perScalarChain: number[][] = scalarNames.map(() => [])

    for (let s = 0; s < nDrawsPerChain; s++) {
      const globalS = c * nDrawsPerChain + s
      const p = ch.params.subarray(s * layout.totalDim, (s + 1) * layout.totalDim)

      // Reconstruct theta, delta, eta, b
      const sigmaTheta = Math.exp(p[layout.logSigmaTheta])
      const sigmaDelta = Math.exp(p[layout.logSigmaDelta])
      const theta = new Float64Array(N)
      for (let i = 0; i < N; i++) theta[i] = sigmaTheta * p[layout.z + i]

      // w_centered
      const sumByPart = new Float64Array(N)
      const countByPart = new Float64Array(N)
      for (let t = 0; t < T; t++) {
        sumByPart[data.participantIdx[t]] += p[layout.wRaw + t]
        countByPart[data.participantIdx[t]] += 1
      }
      const eta = new Float64Array(T)
      for (let t = 0; t < T; t++) {
        const pt = data.participantIdx[t]
        const mean = countByPart[pt] > 0 ? sumByPart[pt] / countByPart[pt] : 0
        const wCent = p[layout.wRaw + t] - mean
        const delta = sigmaDelta * wCent
        eta[t] = theta[pt] + delta
      }

      // baseline & qRel
      for (let i = 0; i < N; i++) baseline[globalS * N + i] = sigmoid(theta[i])
      for (let t = 0; t < T; t++) qRel[globalS * T + t] = sigmoid(eta[t])

      // Direct signal params
      const alphaM = new Float64Array(layout.D)
      const lambdaM = new Float64Array(layout.D)
      if (layout.D > 0) {
        alphaM[0] = 0
        lambdaM[0] = 1
        for (let k = 1; k < layout.D; k++) {
          alphaM[k] = p[layout.alphaMFree + (k - 1)]
          lambdaM[k] = Math.exp(p[layout.logLambdaMFree + (k - 1)])
        }
      }

      // Fatigue
      const alphaF = new Float64Array(layout.F)
      const gammaF = new Float64Array(layout.F)
      let muF = 0
      if (layout.F > 0) {
        muF = p[layout.muF]
        if (layout.F === 1) {
          alphaF[0] = 0
        } else {
          let s2 = 0
          for (let k = 0; k < layout.F; k++) s2 += p[layout.alphaFRaw + k]
          const m = s2 / layout.F
          for (let k = 0; k < layout.F; k++) alphaF[k] = p[layout.alphaFRaw + k] - m
        }
        for (let k = 0; k < layout.F; k++) gammaF[k] = Math.exp(p[layout.logGammaF + k])
      }

      // Confidence
      const alphaC = new Float64Array(layout.C)
      let muC = 0
      let sigmaB = 0
      let bVec: Float64Array | null = null
      if (layout.C > 0) {
        muC = p[layout.muC]
        sigmaB = Math.exp(p[layout.logSigmaB])
        if (layout.C === 1) {
          alphaC[0] = 0
        } else {
          let s2 = 0
          for (let k = 0; k < layout.C; k++) s2 += p[layout.alphaCRaw + k]
          const m = s2 / layout.C
          for (let k = 0; k < layout.C; k++) alphaC[k] = p[layout.alphaCRaw + k] - m
        }
        let bMean = 0
        for (let i = 0; i < N; i++) bMean += p[layout.bRaw + i]
        bMean /= N
        bVec = new Float64Array(N)
        for (let i = 0; i < N; i++) bVec[i] = sigmaB * (p[layout.bRaw + i] - bMean)
        if (bDraws) {
          for (let i = 0; i < N; i++) bDraws[globalS * N + i] = bVec[i]
        }
      }

      // yRep — direct
      for (let o = 0; o < data.direct.obsValues.length; o++) {
        const t = data.direct.obsQuestIdx[o]
        const k = data.direct.obsColIdx[o]
        const x = alphaM[k] + lambdaM[k] * eta[t]
        yRepDirect[globalS * data.direct.obsValues.length + o] = sampleOrderedLogistic(x, cutsDirect[k], rng)
      }
      // yRep — fatigue
      for (let o = 0; o < data.fatigue.obsValues.length; o++) {
        const t = data.fatigue.obsQuestIdx[o]
        const k = data.fatigue.obsColIdx[o]
        const sigmaDeltaTimesW = eta[t] - theta[data.participantIdx[t]]
        void sigmaDeltaTimesW
        const delta = eta[t] - theta[data.participantIdx[t]]
        const x = muF + alphaF[k] + gammaF[k] * delta
        yRepFatigue[globalS * data.fatigue.obsValues.length + o] = sampleOrderedLogistic(x, cutsFatigue[k], rng)
      }
      // yRep — confidence
      for (let o = 0; o < data.confidence.obsValues.length; o++) {
        const t = data.confidence.obsQuestIdx[o]
        const k = data.confidence.obsColIdx[o]
        const pt = data.participantIdx[t]
        const x = muC + alphaC[k] + eta[t] + (bVec ? bVec[pt] : 0)
        yRepConfidence[globalS * data.confidence.obsValues.length + o] = sampleOrderedLogistic(x, cutsConfidence[k], rng)
      }

      // scalars
      let scIdx = 0
      scalars[globalS * scalarNames.length + scIdx] = sigmaTheta
      perScalarChain[scIdx].push(sigmaTheta)
      scIdx++
      scalars[globalS * scalarNames.length + scIdx] = sigmaDelta
      perScalarChain[scIdx].push(sigmaDelta)
      scIdx++
      if (layout.F > 0) {
        scalars[globalS * scalarNames.length + scIdx] = muF
        perScalarChain[scIdx].push(muF)
        scIdx++
      }
      if (layout.C > 0) {
        scalars[globalS * scalarNames.length + scIdx] = muC
        perScalarChain[scIdx].push(muC)
        scIdx++
        scalars[globalS * scalarNames.length + scIdx] = sigmaB
        perScalarChain[scIdx].push(sigmaB)
        scIdx++
      }
    }
    for (let i = 0; i < scalarNames.length; i++) {
      scalarByChain[i].push(new Float64Array(perScalarChain[i]))
    }
  }

  yRep['direct'] = yRepDirect
  yRep['fatigue'] = yRepFatigue
  yRep['confidence'] = yRepConfidence

  const draws: PosteriorDraws = {
    baselineReliability: baseline,
    questionnaireReliability: qRel,
    b: bDraws,
    yRep,
    scalarNames,
    scalars,
    nDraws: S,
    N,
    T,
  }

  // Diagnostics: R-hat/ESS on scalars
  let rHatMax = 1
  let essMin = Infinity
  for (let i = 0; i < scalarNames.length; i++) {
    const r = splitRhat(scalarByChain[i])
    if (Number.isFinite(r) && r > rHatMax) rHatMax = r
    const e = ess(scalarByChain[i])
    if (Number.isFinite(e) && e < essMin) essMin = e
  }
  if (!Number.isFinite(essMin)) essMin = 0
  const diagnostics: Diagnostics = {
    rHatMax,
    essMin,
    divergences,
    runtimeMs: 0,
    converged: rHatMax < 1.05 && divergences === 0,
  }

  return { draws, diagnostics }
}

export function serializePosterior(
  draws: PosteriorDraws,
  diagnostics: Diagnostics,
): SerializedSamplerResult {
  const yRep: Record<string, number[]> = {}
  for (const k of Object.keys(draws.yRep)) {
    yRep[k] = Array.from(draws.yRep[k])
  }
  return {
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
}
