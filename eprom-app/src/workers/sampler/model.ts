// Log-posterior with analytical gradients in unconstrained space.
// Model mirrors precision_bundle/unified_ordinal_reliability_model.py exactly,
// with FIX_CONFIDENCE_ETA_LOADING = True (lambda_c = 1 fixed).

import type { StanData, FamilyData } from '../../lib/types'
import { fixedCutpoints } from '../../lib/preprocess'

const HALF_LOG_2PI = 0.5 * Math.log(2 * Math.PI)
const HALFNORMAL_LOG_C = Math.log(2) - HALF_LOG_2PI // log(2/sqrt(2π)) = log 2 - 0.5 log(2π)

export interface ParamLayout {
  totalDim: number
  // indices (offsets) into the unconstrained parameter vector
  logSigmaTheta: number
  z: number // N
  logSigmaDelta: number
  wRaw: number // T
  alphaMFree: number // D-1
  logLambdaMFree: number // D-1
  muF: number // 1 if F>0 else -1
  alphaFRaw: number // F if F>1 else -1
  logGammaF: number // F if F>0 else -1
  muC: number // 1 if C>0 else -1
  logSigmaB: number // 1 if C>0 else -1
  bRaw: number // N if C>0 else -1
  alphaCRaw: number // C if C>1 else -1
  N: number
  T: number
  D: number
  F: number
  C: number
}

export function buildLayout(data: StanData): ParamLayout {
  const N = data.N
  const T = data.T
  const D = data.direct.nCols
  const F = data.fatigue.nCols
  const C = data.confidence.nCols
  let offset = 0
  const logSigmaTheta = offset++
  const z = offset
  offset += N
  const logSigmaDelta = offset++
  const wRaw = offset
  offset += T
  const alphaMFree = D > 1 ? offset : -1
  if (D > 1) offset += D - 1
  const logLambdaMFree = D > 1 ? offset : -1
  if (D > 1) offset += D - 1
  const muF = F > 0 ? offset++ : -1
  const alphaFRaw = F > 1 ? offset : -1
  if (F > 1) offset += F
  const logGammaF = F > 0 ? offset : -1
  if (F > 0) offset += F
  const muC = C > 0 ? offset++ : -1
  const logSigmaB = C > 0 ? offset++ : -1
  const bRaw = C > 0 ? offset : -1
  if (C > 0) offset += N
  const alphaCRaw = C > 1 ? offset : -1
  if (C > 1) offset += C
  return {
    totalDim: offset,
    logSigmaTheta,
    z,
    logSigmaDelta,
    wRaw,
    alphaMFree,
    logLambdaMFree,
    muF,
    alphaFRaw,
    logGammaF,
    muC,
    logSigmaB,
    bRaw,
    alphaCRaw,
    N,
    T,
    D,
    F,
    C,
  }
}

export function initParams(rng: { normal(): number }, layout: ParamLayout): Float64Array {
  const p = new Float64Array(layout.totalDim)
  // Small random init on unconstrained scale
  for (let i = 0; i < layout.totalDim; i++) p[i] = rng.normal() * 0.1
  // log_sigma_* start near log(0.5) so scale ~ 0.5 (reasonable)
  p[layout.logSigmaTheta] = -0.7 + p[layout.logSigmaTheta] * 0.05
  p[layout.logSigmaDelta] = -1.0 + p[layout.logSigmaDelta] * 0.05
  if (layout.logSigmaB >= 0) p[layout.logSigmaB] = -1.0 + p[layout.logSigmaB] * 0.05
  // log_lambda / log_gamma start at 0 so lambda≈1
  return p
}

interface Cutpoints {
  // one Float64Array per column
  direct: Float64Array[]
  fatigue: Float64Array[]
  confidence: Float64Array[]
}

export function buildCutpoints(data: StanData): Cutpoints {
  const mk = (family: FamilyData) => {
    const out: Float64Array[] = []
    for (let c = 0; c < family.nCols; c++) out.push(fixedCutpoints(family.maxScores[c]))
    return out
  }
  return {
    direct: mk(data.direct),
    fatigue: mk(data.fatigue),
    confidence: mk(data.confidence),
  }
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x)
    return 1 / (1 + z)
  } else {
    const z = Math.exp(x)
    return z / (1 + z)
  }
}

// log(sigmoid(x)) numerically stable
function logSigmoid(x: number): number {
  if (x >= 0) return -Math.log1p(Math.exp(-x))
  return x - Math.log1p(Math.exp(x))
}

// log(sigmoid(a) - sigmoid(b)) where a > b (both from cutpoints)
// Returns [logP, dlogP/dEta] where η is the predictor; sigmoid args here are (c_s - η) so
// derivative wrt η follows from -d/dc.
// We pass raw A_s and A_{s-1} pre-computed to caller.

// Ordered logistic log-prob for category s given predictor x and cutpoints c[0..K-2].
// Returns { logP, dLogP_dx, A_s, A_sm1 }.
function orderedLogisticStep(
  x: number,
  s: number,
  c: Float64Array,
): { logP: number; dLogP_dx: number } {
  const maxScore = c.length // K-1 cutpoints, K = maxScore+1 categories 0..maxScore
  // A_s = sigmoid(c[s] - x); A_{-1} = 0; A_{maxScore} = 1
  if (s === 0) {
    // P = A_0 = sigmoid(c[0] - x); log P = logSigmoid(c[0]-x)
    const arg = c[0] - x
    const A0 = sigmoid(arg)
    const logP = logSigmoid(arg)
    // dlogP/dx = -(1 - A0) = A0 - 1
    return { logP, dLogP_dx: A0 - 1 }
  } else if (s === maxScore) {
    // P = 1 - A_{maxScore-1} = sigmoid(x - c[maxScore-1])
    const arg = x - c[maxScore - 1]
    const P = sigmoid(arg)
    const logP = logSigmoid(arg)
    // dlogP/dx = 1 - P
    return { logP, dLogP_dx: 1 - P }
  } else {
    // P(y=s|η) = σ(c[s]-η) - σ(c[s-1]-η); c ascending so σ(c[s]-η) > σ(c[s-1]-η)
    const As = sigmoid(c[s] - x)
    const Asm1 = sigmoid(c[s - 1] - x)
    const P = As - Asm1
    const logP = Math.log(Math.max(P, 1e-300))
    // dA/dx = -A(1-A). so dP/dx = -As(1-As) + Asm1(1-Asm1)
    const dP_dx = Asm1 * (1 - Asm1) - As * (1 - As)
    const dLogP_dx = dP_dx / Math.max(P, 1e-300)
    return { logP, dLogP_dx }
  }
}

export interface LogpResult {
  logp: number
  grad: Float64Array
}

// Reusable workspace to reduce allocation.
export interface Workspace {
  theta: Float64Array
  wSumByPart: Float64Array
  wCentered: Float64Array
  delta: Float64Array
  eta: Float64Array
  bVec: Float64Array | null
  bMean: number
  // gradients wrt derived
  gEta: Float64Array
  gDelta: Float64Array
  gB: Float64Array | null
  gAlphaM: Float64Array
  gLambdaM: Float64Array
  gAlphaFCentered: Float64Array
  gGammaF: Float64Array
  gAlphaCCentered: Float64Array
  partCounts: Float64Array
}

export function makeWorkspace(layout: ParamLayout): Workspace {
  const { N, T, D, F, C } = layout
  return {
    theta: new Float64Array(N),
    wSumByPart: new Float64Array(N),
    wCentered: new Float64Array(T),
    delta: new Float64Array(T),
    eta: new Float64Array(T),
    bVec: C > 0 ? new Float64Array(N) : null,
    bMean: 0,
    gEta: new Float64Array(T),
    gDelta: new Float64Array(T),
    gB: C > 0 ? new Float64Array(N) : null,
    gAlphaM: new Float64Array(D),
    gLambdaM: new Float64Array(D),
    gAlphaFCentered: new Float64Array(F),
    gGammaF: new Float64Array(F),
    gAlphaCCentered: new Float64Array(C),
    partCounts: new Float64Array(N),
  }
}

export function precomputePartCounts(
  layout: ParamLayout,
  data: StanData,
  ws: Workspace,
): void {
  ws.partCounts.fill(0)
  for (let t = 0; t < layout.T; t++) ws.partCounts[data.participantIdx[t]] += 1
}

export function logpAndGrad(
  params: Float64Array,
  data: StanData,
  layout: ParamLayout,
  cuts: Cutpoints,
  ws: Workspace,
): LogpResult {
  const { N, T, D, F, C } = layout
  const grad = new Float64Array(layout.totalDim)
  let logp = 0

  // === Extract & transform parameters ===
  const logSigmaTheta = params[layout.logSigmaTheta]
  const sigmaTheta = Math.exp(logSigmaTheta)
  const logSigmaDelta = params[layout.logSigmaDelta]
  const sigmaDelta = Math.exp(logSigmaDelta)

  // theta[i] = sigmaTheta * z[i]
  for (let i = 0; i < N; i++) {
    ws.theta[i] = sigmaTheta * params[layout.z + i]
  }

  // w_centered
  ws.wSumByPart.fill(0)
  for (let t = 0; t < T; t++) {
    ws.wSumByPart[data.participantIdx[t]] += params[layout.wRaw + t]
  }
  for (let t = 0; t < T; t++) {
    const p = data.participantIdx[t]
    const n = ws.partCounts[p]
    const mean = n > 0 ? ws.wSumByPart[p] / n : 0
    ws.wCentered[t] = params[layout.wRaw + t] - mean
    ws.delta[t] = sigmaDelta * ws.wCentered[t]
    ws.eta[t] = ws.theta[data.participantIdx[t]] + ws.delta[t]
  }

  // Direct signal params
  const alphaM = new Float64Array(D)
  const lambdaM = new Float64Array(D)
  if (D > 0) {
    alphaM[0] = 0
    lambdaM[0] = 1
    for (let k = 1; k < D; k++) {
      alphaM[k] = params[layout.alphaMFree + (k - 1)]
      lambdaM[k] = Math.exp(params[layout.logLambdaMFree + (k - 1)])
    }
  }

  // Fatigue signal params
  const alphaFCentered = new Float64Array(F)
  const gammaF = new Float64Array(F)
  let muF = 0
  if (F > 0) {
    muF = params[layout.muF]
    if (F === 1) {
      alphaFCentered[0] = 0
    } else {
      let s = 0
      for (let k = 0; k < F; k++) s += params[layout.alphaFRaw + k]
      const m = s / F
      for (let k = 0; k < F; k++) alphaFCentered[k] = params[layout.alphaFRaw + k] - m
    }
    for (let k = 0; k < F; k++) gammaF[k] = Math.exp(params[layout.logGammaF + k])
  }

  // Confidence signal params + b
  const alphaCCentered = new Float64Array(C)
  let muC = 0
  let sigmaB = 0
  if (C > 0) {
    muC = params[layout.muC]
    sigmaB = Math.exp(params[layout.logSigmaB])
    if (C === 1) {
      alphaCCentered[0] = 0
    } else {
      let s = 0
      for (let k = 0; k < C; k++) s += params[layout.alphaCRaw + k]
      const m = s / C
      for (let k = 0; k < C; k++) alphaCCentered[k] = params[layout.alphaCRaw + k] - m
    }
    let sB = 0
    for (let i = 0; i < N; i++) sB += params[layout.bRaw + i]
    ws.bMean = sB / N
    for (let i = 0; i < N; i++) {
      ws.bVec![i] = sigmaB * (params[layout.bRaw + i] - ws.bMean)
    }
  }

  // === Priors ===
  // sigma_theta ~ HalfNormal(1): logp += log 2 - 0.5*log(2π) - 0.5*sigma^2
  // + Jacobian log|dsigma/dlogsigma| = log(sigma) = logSigmaTheta
  logp += HALFNORMAL_LOG_C - 0.5 * sigmaTheta * sigmaTheta + logSigmaTheta
  // grad wrt logSigmaTheta from prior: d/dlogσ [-0.5 σ^2 + logσ] where σ=exp(logσ)
  // = -0.5 * 2σ * σ + 1 = -σ^2 + 1
  grad[layout.logSigmaTheta] += -sigmaTheta * sigmaTheta + 1

  // z ~ N(0,1)
  for (let i = 0; i < N; i++) {
    const zi = params[layout.z + i]
    logp += -HALF_LOG_2PI - 0.5 * zi * zi
    grad[layout.z + i] += -zi
  }

  // sigma_delta ~ HalfNormal(0.5): logp += log 2 - 0.5*log(2π*0.25) - 0.5*sigma^2/0.25
  const invVarD = 1 / (0.5 * 0.5)
  logp += Math.log(2) - HALF_LOG_2PI - Math.log(0.5) - 0.5 * sigmaDelta * sigmaDelta * invVarD + logSigmaDelta
  grad[layout.logSigmaDelta] += -sigmaDelta * sigmaDelta * invVarD + 1

  // w_raw ~ N(0,1)
  for (let t = 0; t < T; t++) {
    const wr = params[layout.wRaw + t]
    logp += -HALF_LOG_2PI - 0.5 * wr * wr
    grad[layout.wRaw + t] += -wr
  }

  // alpha_m_free ~ N(0,1); lambda_m_free ~ HalfNormal(1)
  for (let k = 1; k < D; k++) {
    const a = params[layout.alphaMFree + (k - 1)]
    logp += -HALF_LOG_2PI - 0.5 * a * a
    grad[layout.alphaMFree + (k - 1)] += -a
    const lg = params[layout.logLambdaMFree + (k - 1)]
    const lam = lambdaM[k]
    logp += HALFNORMAL_LOG_C - 0.5 * lam * lam + lg
    grad[layout.logLambdaMFree + (k - 1)] += -lam * lam + 1
  }

  if (F > 0) {
    logp += -HALF_LOG_2PI - 0.5 * muF * muF
    grad[layout.muF] += -muF
    if (F > 1) {
      for (let k = 0; k < F; k++) {
        const ar = params[layout.alphaFRaw + k]
        logp += -HALF_LOG_2PI - 0.5 * ar * ar
        grad[layout.alphaFRaw + k] += -ar
      }
    }
    for (let k = 0; k < F; k++) {
      const lg = params[layout.logGammaF + k]
      const g = gammaF[k]
      logp += HALFNORMAL_LOG_C - 0.5 * g * g + lg
      grad[layout.logGammaF + k] += -g * g + 1
    }
  }

  if (C > 0) {
    logp += -HALF_LOG_2PI - 0.5 * muC * muC
    grad[layout.muC] += -muC
    // sigma_b ~ HalfNormal(0.5)
    logp += Math.log(2) - HALF_LOG_2PI - Math.log(0.5) - 0.5 * sigmaB * sigmaB * invVarD + params[layout.logSigmaB]
    grad[layout.logSigmaB] += -sigmaB * sigmaB * invVarD + 1
    for (let i = 0; i < N; i++) {
      const br = params[layout.bRaw + i]
      logp += -HALF_LOG_2PI - 0.5 * br * br
      grad[layout.bRaw + i] += -br
    }
    if (C > 1) {
      for (let k = 0; k < C; k++) {
        const ar = params[layout.alphaCRaw + k]
        logp += -HALF_LOG_2PI - 0.5 * ar * ar
        grad[layout.alphaCRaw + k] += -ar
      }
    }
  }

  // === Likelihoods ===
  ws.gEta.fill(0)
  ws.gDelta.fill(0)
  ws.gAlphaM.fill(0)
  ws.gLambdaM.fill(0)
  ws.gAlphaFCentered.fill(0)
  ws.gGammaF.fill(0)
  ws.gAlphaCCentered.fill(0)
  if (ws.gB) ws.gB.fill(0)

  // Direct
  {
    const nObs = data.direct.obsValues.length
    for (let o = 0; o < nObs; o++) {
      const t = data.direct.obsQuestIdx[o]
      const k = data.direct.obsColIdx[o]
      const y = data.direct.obsValues[o]
      const x = alphaM[k] + lambdaM[k] * ws.eta[t]
      const { logP, dLogP_dx } = orderedLogisticStep(x, y, cuts.direct[k])
      logp += logP
      // Accumulate
      ws.gEta[t] += dLogP_dx * lambdaM[k]
      if (k > 0) {
        ws.gAlphaM[k] += dLogP_dx
        ws.gLambdaM[k] += dLogP_dx * ws.eta[t]
      }
    }
  }

  // Fatigue
  if (F > 0) {
    const nObs = data.fatigue.obsValues.length
    let sumMuF = 0
    for (let o = 0; o < nObs; o++) {
      const t = data.fatigue.obsQuestIdx[o]
      const k = data.fatigue.obsColIdx[o]
      const y = data.fatigue.obsValues[o]
      const x = muF + alphaFCentered[k] + gammaF[k] * ws.delta[t]
      const { logP, dLogP_dx } = orderedLogisticStep(x, y, cuts.fatigue[k])
      logp += logP
      sumMuF += dLogP_dx
      ws.gAlphaFCentered[k] += dLogP_dx
      ws.gGammaF[k] += dLogP_dx * ws.delta[t]
      ws.gDelta[t] += dLogP_dx * gammaF[k]
    }
    grad[layout.muF] += sumMuF
  }

  // Confidence
  if (C > 0) {
    const nObs = data.confidence.obsValues.length
    let sumMuC = 0
    for (let o = 0; o < nObs; o++) {
      const t = data.confidence.obsQuestIdx[o]
      const k = data.confidence.obsColIdx[o]
      const y = data.confidence.obsValues[o]
      const p = data.participantIdx[t]
      const x = muC + alphaCCentered[k] + ws.eta[t] + ws.bVec![p]
      const { logP, dLogP_dx } = orderedLogisticStep(x, y, cuts.confidence[k])
      logp += logP
      sumMuC += dLogP_dx
      ws.gAlphaCCentered[k] += dLogP_dx
      ws.gEta[t] += dLogP_dx
      ws.gB![p] += dLogP_dx
    }
    grad[layout.muC] += sumMuC
  }

  // === Backprop through centering / reparametrization ===

  // alpha_f_raw: alpha_f = alpha_f_raw - mean(alpha_f_raw)
  // d alpha_f[k]/d alpha_f_raw[j] = δ_kj - 1/F
  // total gradient wrt alpha_f_raw[j] = sum_k gAlphaFCentered[k] * (δ_kj - 1/F) = gAlphaFCentered[j] - mean(gAlphaFCentered)
  if (F > 1) {
    let m = 0
    for (let k = 0; k < F; k++) m += ws.gAlphaFCentered[k]
    m /= F
    for (let k = 0; k < F; k++) grad[layout.alphaFRaw + k] += ws.gAlphaFCentered[k] - m
  }
  // log_gamma_f: gamma_f = exp(log_gamma_f); d gamma/d log_gamma = gamma
  for (let k = 0; k < F; k++) grad[layout.logGammaF + k] += ws.gGammaF[k] * gammaF[k]

  // alpha_c_raw
  if (C > 1) {
    let m = 0
    for (let k = 0; k < C; k++) m += ws.gAlphaCCentered[k]
    m /= C
    for (let k = 0; k < C; k++) grad[layout.alphaCRaw + k] += ws.gAlphaCCentered[k] - m
  }

  // alpha_m_free, log_lambda_m_free
  for (let k = 1; k < D; k++) {
    grad[layout.alphaMFree + (k - 1)] += ws.gAlphaM[k]
    grad[layout.logLambdaMFree + (k - 1)] += ws.gLambdaM[k] * lambdaM[k]
  }

  // b[i] = sigma_b * (b_raw[i] - mean(b_raw))
  // d b[i]/d b_raw[j] = sigma_b * (δ_ij - 1/N)
  // d b[i]/d sigma_b = b_raw[i] - mean(b_raw) = b[i]/sigma_b (call it bcent[i])
  if (C > 0) {
    let sumGB = 0
    let sumGBTimesBcent = 0
    for (let i = 0; i < N; i++) sumGB += ws.gB![i]
    const meanGB = sumGB / N
    for (let i = 0; i < N; i++) {
      const bcent = ws.bVec![i] / (sigmaB || 1e-300)
      grad[layout.bRaw + i] += (ws.gB![i] - meanGB) * sigmaB
      sumGBTimesBcent += ws.gB![i] * bcent
    }
    grad[layout.logSigmaB] += sumGBTimesBcent * sigmaB
  }

  // eta[t] backprop: eta = theta[p] + delta; grad theta[i] += sum_{t:p[t]=i} gEta[t]; grad delta[t] += gEta[t]
  // Then delta[t] = sigma_delta * w_centered[t]; theta[i] = sigma_theta * z[i]
  // Direct fatigue also contributes gDelta[t] via delta.
  for (let t = 0; t < T; t++) {
    ws.gDelta[t] += ws.gEta[t]
  }

  // Backprop through theta[i] via sum over t
  const gTheta = new Float64Array(N)
  for (let t = 0; t < T; t++) gTheta[data.participantIdx[t]] += ws.gEta[t]

  // logSigmaTheta grad from d theta / d sigmaTheta * d sigmaTheta / d logSigmaTheta = z[i] * sigmaTheta
  let sumZgTheta = 0
  for (let i = 0; i < N; i++) {
    sumZgTheta += params[layout.z + i] * gTheta[i]
    grad[layout.z + i] += gTheta[i] * sigmaTheta
  }
  grad[layout.logSigmaTheta] += sumZgTheta * sigmaTheta

  // w_centered[t] = w_raw[t] - mean(w_raw[p[t]])
  // d w_centered[t]/d w_raw[t'] = δ_{tt'} - (1/n[p[t]]) * [p[t']==p[t]]
  // total grad wrt w_raw[t'] = sum_t gDelta_scaled[t] * (δ_{tt'} - ...) where gDelta_scaled = gDelta * sigma_delta
  // = gWc[t'] - (sum over t with p[t]=p[t']) gWc[t] / n[p[t']]
  const gWc = new Float64Array(T)
  let sumWcTimesGWc = 0
  for (let t = 0; t < T; t++) {
    gWc[t] = ws.gDelta[t] * sigmaDelta
    sumWcTimesGWc += ws.wCentered[t] * ws.gDelta[t]
  }
  // Compute sum of gWc within each participant
  const sumGWcByPart = new Float64Array(N)
  for (let t = 0; t < T; t++) sumGWcByPart[data.participantIdx[t]] += gWc[t]

  for (let t = 0; t < T; t++) {
    const p = data.participantIdx[t]
    const n = ws.partCounts[p]
    grad[layout.wRaw + t] += gWc[t] - sumGWcByPart[p] / (n || 1)
  }
  grad[layout.logSigmaDelta] += sumWcTimesGWc * sigmaDelta

  return { logp, grad }
}
