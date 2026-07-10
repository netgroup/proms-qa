// Minimal FD check: N=2, T=2, D=1, F=0, C=0.
import { buildLayout, buildCutpoints, initParams, logpAndGrad, makeWorkspace, precomputePartCounts } from '../src/workers/sampler/model.ts'

const N = 2, T = 4
const participantIdx = new Int32Array([0,0,1,1])
function fill(a,v){ for (let i=0;i<a.length;i++) a[i]=v; return a }
const data = {
  N, T, participantIdx,
  direct: { nCols: 1, maxScores: fill(new Int32Array(1), 4),
    obsValues: new Int32Array([1,2,3,2]),
    obsQuestIdx: new Int32Array([0,1,2,3]),
    obsColIdx: new Int32Array([0,0,0,0]) },
  fatigue: { nCols: 0, maxScores: new Int32Array(0), obsValues: new Int32Array(0), obsQuestIdx: new Int32Array(0), obsColIdx: new Int32Array(0) },
  confidence: { nCols: 0, maxScores: new Int32Array(0), obsValues: new Int32Array(0), obsQuestIdx: new Int32Array(0), obsColIdx: new Int32Array(0) },
}
const layout = buildLayout(data)
console.log('layout:', layout)
const cuts = buildCutpoints(data)
const ws = makeWorkspace(layout)
precomputePartCounts(layout, data, ws)

// Set a specific param vector for reproducibility
const p = new Float64Array(layout.totalDim)
p[layout.logSigmaTheta] = -0.5
for (let i = 0; i < N; i++) p[layout.z + i] = 0.1 * (i - N/2)
p[layout.logSigmaDelta] = -0.7
for (let t = 0; t < T; t++) p[layout.wRaw + t] = 0.05 * t

const { logp, grad } = logpAndGrad(p, data, layout, cuts, ws)
console.log('logp:', logp, 'grad:', Array.from(grad).map(x=>x.toFixed(4)))

const h = 1e-5
for (let i = 0; i < layout.totalDim; i++) {
  const orig = p[i]
  p[i] = orig + h
  const l1 = logpAndGrad(p, data, layout, cuts, ws).logp
  p[i] = orig - h
  const l2 = logpAndGrad(p, data, layout, cuts, ws).logp
  p[i] = orig
  const fd = (l1 - l2) / (2 * h)
  console.log(`  [${i}] analytical=${grad[i].toFixed(6)} fd=${fd.toFixed(6)} diff=${(grad[i]-fd).toExponential(2)}`)
}
