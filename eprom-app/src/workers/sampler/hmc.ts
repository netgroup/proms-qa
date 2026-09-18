import type { StanData } from '../../lib/types'
import { RNG } from './rng'
import {
  buildLayout,
  buildCutpoints,
  initParams,
  logpAndGrad,
  makeWorkspace,
  precomputePartCounts,
  ParamLayout,
} from './model'

export interface HmcOptions {
  seed: number
  warmup: number
  draws: number
  adaptDelta: number
  leapfrogSteps?: number
  initialStepSize?: number
  onProgress?: (progress: { phase: 'warmup' | 'sampling'; iter: number; total: number }) => void
}

interface ChainDraws {
  params: Float64Array // shape (draws, totalDim), row-major
  logp: Float64Array // (draws,)
  divergences: number
  acceptanceRate: number
  stepSize: number
}

// Leapfrog with a diagonal metric expressed as per-dimension scales s[i]
// (equivalent to mass matrix M^{-1} = diag(s^2), momentum ~ N(0, I)).
function leapfrog(
  q: Float64Array,
  p: Float64Array,
  grad: Float64Array,
  eps: number,
  L: number,
  scale: Float64Array,
  data: StanData,
  layout: ParamLayout,
  cuts: ReturnType<typeof buildCutpoints>,
  ws: ReturnType<typeof makeWorkspace>,
): { newLogp: number; newGrad: Float64Array; newQ: Float64Array; newP: Float64Array } {
  const d = q.length
  const newQ = new Float64Array(q)
  const newP = new Float64Array(p)
  let g = grad
  for (let step = 0; step < L; step++) {
    for (let i = 0; i < d; i++) newP[i] += 0.5 * eps * scale[i] * g[i]
    for (let i = 0; i < d; i++) newQ[i] += eps * scale[i] * newP[i]
    const res = logpAndGrad(newQ, data, layout, cuts, ws)
    g = res.grad
    for (let i = 0; i < d; i++) newP[i] += 0.5 * eps * scale[i] * g[i]
    // Track NaN/Inf → divergent
    if (!Number.isFinite(res.logp)) {
      return { newLogp: -Infinity, newGrad: g, newQ, newP }
    }
  }
  const res = logpAndGrad(newQ, data, layout, cuts, ws)
  return { newLogp: res.logp, newGrad: res.grad, newQ, newP }
}

// Stan-style warmup schedule for diagonal-metric adaptation:
// [0, init) step-size only · [init, warmup-term) doubling variance windows,
// metric updated at each window end · [warmup-term, warmup) step-size only.
interface AdaptSchedule {
  init: number
  term: number
  windowEnds: number[]
}

function buildSchedule(warmup: number): AdaptSchedule {
  const init = Math.min(75, Math.floor(warmup * 0.15))
  const term = Math.min(50, Math.floor(warmup * 0.1))
  const windowEnds: number[] = []
  let w = Math.min(25, Math.max(1, Math.floor(warmup * 0.1)))
  let pos = init
  const last = warmup - term
  while (pos + w <= last) {
    pos += w
    // If the remaining span can't fit the next (doubled) window, extend this one to the end
    if (pos + w * 2 > last) {
      windowEnds.push(last)
      pos = last
      break
    }
    windowEnds.push(pos)
    w *= 2
  }
  if (windowEnds.length === 0 && last > init) windowEnds.push(last)
  return { init, term, windowEnds }
}

function runChain(
  chainIdx: number,
  data: StanData,
  layout: ParamLayout,
  opts: HmcOptions,
): ChainDraws {
  const rng = new RNG(opts.seed + chainIdx * 7919)
  const cuts = buildCutpoints(data)
  const ws = makeWorkspace(layout)
  precomputePartCounts(layout, data, ws)

  let q = initParams(rng, layout)
  let cur = logpAndGrad(q, data, layout, cuts, ws)
  let curLogp = cur.logp
  let curGrad = cur.grad
  const d = q.length

  const L = opts.leapfrogSteps ?? 15
  let eps = opts.initialStepSize ?? 0.05
  const targetAccept = opts.adaptDelta

  // Diagonal metric (per-dimension scale = sqrt of estimated posterior variance)
  const scale = new Float64Array(d).fill(1)
  const schedule = buildSchedule(opts.warmup)
  // Welford accumulators for the current variance window
  let wCount = 0
  const wMean = new Float64Array(d)
  const wM2 = new Float64Array(d)
  let nextWindow = 0

  // Dual-averaging state (Hoffman & Gelman 2014, Algorithm 5)
  let mu = Math.log(10 * eps)
  const gamma = 0.05
  const t0 = 10
  const kappa = 0.75
  let H = 0
  let logEpsBar = 0
  let daIter = 0

  const totalIters = opts.warmup + opts.draws
  const draws = new Float64Array(opts.draws * d)
  const logpTrace = new Float64Array(opts.draws)
  let divergences = 0
  let accepts = 0

  const progressEvery = Math.max(1, Math.floor(totalIters / 40))

  for (let iter = 0; iter < totalIters; iter++) {
    const isWarmup = iter < opts.warmup

    // Momentum from N(0, I) in scaled space
    const p = new Float64Array(d)
    for (let i = 0; i < d; i++) p[i] = rng.normal()

    let ke = 0
    for (let i = 0; i < d; i++) ke += p[i] * p[i]
    const H0 = -curLogp + 0.5 * ke

    // Randomize L a bit
    const Lrand = Math.max(1, L + Math.floor((rng.next() - 0.5) * L * 0.4))

    const { newLogp, newGrad, newQ, newP } = leapfrog(q, p, curGrad, eps, Lrand, scale, data, layout, cuts, ws)

    let newKe = 0
    for (let i = 0; i < d; i++) newKe += newP[i] * newP[i]
    const H1 = -newLogp + 0.5 * newKe

    const dH = H0 - H1 // higher = better
    const accProb = Math.min(1, Math.exp(dH))

    // Divergence: extreme energy jump. Warmup divergences are expected while
    // the metric/step size adapt (Stan reports them separately) — count only
    // sampling-phase ones.
    if (!isWarmup && (!Number.isFinite(H1) || Math.abs(H1 - H0) > 1000)) {
      divergences++
    }

    if (Number.isFinite(H1) && rng.next() < accProb) {
      q = newQ
      curLogp = newLogp
      curGrad = newGrad
      accepts++
    }

    if (isWarmup) {
      // Dual-averaging step-size adaptation
      daIter++
      const eta = 1 / (daIter + t0)
      const accProbFinite = Number.isFinite(accProb) ? accProb : 0
      H = (1 - eta) * H + eta * (targetAccept - accProbFinite)
      const logEps = mu - (Math.sqrt(daIter) / gamma) * H
      const wEta = Math.pow(daIter, -kappa)
      logEpsBar = wEta * logEps + (1 - wEta) * logEpsBar
      eps = Math.exp(logEps)
      // Cap to sensible range
      if (!Number.isFinite(eps) || eps < 1e-6) eps = 1e-6
      if (eps > 5) eps = 5

      // Variance-window accumulation for the diagonal metric
      if (iter >= schedule.init && nextWindow < schedule.windowEnds.length) {
        wCount++
        for (let i = 0; i < d; i++) {
          const delta = q[i] - wMean[i]
          wMean[i] += delta / wCount
          wM2[i] += delta * (q[i] - wMean[i])
        }
        if (iter + 1 === schedule.windowEnds[nextWindow]) {
          if (wCount >= 10) {
            // Regularized variance (Stan-style shrinkage toward 1e-3)
            for (let i = 0; i < d; i++) {
              const v = wM2[i] / (wCount - 1)
              const reg = (wCount / (wCount + 5)) * v + 1e-3 * (5 / (wCount + 5))
              scale[i] = Math.sqrt(Math.max(reg, 1e-8))
            }
            // Metric changed → restart step-size adaptation around the current eps
            mu = Math.log(10 * eps)
            H = 0
            logEpsBar = 0
            daIter = 0
          }
          wCount = 0
          wMean.fill(0)
          wM2.fill(0)
          nextWindow++
        }
      }
    } else if (iter === opts.warmup) {
      // Freeze eps to smoothed value
      eps = Math.exp(logEpsBar)
      if (!Number.isFinite(eps) || eps <= 0) eps = 0.01
    }

    if (!isWarmup) {
      const s = iter - opts.warmup
      draws.set(q, s * d)
      logpTrace[s] = curLogp
    }

    if (opts.onProgress && iter % progressEvery === 0) {
      opts.onProgress({
        phase: isWarmup ? 'warmup' : 'sampling',
        iter,
        total: totalIters,
      })
    }
  }

  return {
    params: draws,
    logp: logpTrace,
    divergences,
    acceptanceRate: accepts / totalIters,
    stepSize: eps,
  }
}

export interface SampleOptions extends HmcOptions {
  chains: number
  onChainStart?: (chain: number, totalChains: number) => void
}

export interface CombinedDraws {
  totalDim: number
  nDrawsPerChain: number
  chains: ChainDraws[]
  layout: ParamLayout
}

export function sample(data: StanData, opts: SampleOptions): CombinedDraws {
  const layout = buildLayout(data)
  const chains: ChainDraws[] = []
  for (let c = 0; c < opts.chains; c++) {
    if (opts.onChainStart) opts.onChainStart(c, opts.chains)
    const chainOpts: HmcOptions = {
      ...opts,
      onProgress: (p) => {
        if (opts.onProgress) {
          opts.onProgress({
            phase: p.phase,
            iter: p.iter + c * (opts.warmup + opts.draws),
            total: opts.chains * (opts.warmup + opts.draws),
          })
        }
      },
    }
    chains.push(runChain(c, data, layout, chainOpts))
  }
  return {
    totalDim: layout.totalDim,
    nDrawsPerChain: opts.draws,
    chains,
    layout,
  }
}
