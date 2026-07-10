// Finite-difference check of the analytical gradient.
import { buildLayout, buildCutpoints, initParams, logpAndGrad, makeWorkspace, precomputePartCounts } from '../src/workers/sampler/model.ts'
import { RNG } from '../src/workers/sampler/rng.ts'

// small dataset
const N = 3, T = 6
const participantIdx = new Int32Array([0,0,1,1,2,2])
function fill(a,v){ for (let i=0;i<a.length;i++) a[i]=v; return a }
const data = {
  N, T, participantIdx,
  direct: { nCols: 2, maxScores: fill(new Int32Array(2), 4),
    obsValues: new Int32Array([1,2,3,4,2,1, 0,3,2,1,4,2]),
    obsQuestIdx: new Int32Array([0,1,2,3,4,5, 0,1,2,3,4,5]),
    obsColIdx: new Int32Array([0,0,0,0,0,0, 1,1,1,1,1,1]) },
  fatigue: { nCols: 1, maxScores: fill(new Int32Array(1), 4),
    obsValues: new Int32Array([2,3,1,2,3,1]),
    obsQuestIdx: new Int32Array([0,1,2,3,4,5]),
    obsColIdx: new Int32Array([0,0,0,0,0,0]) },
  confidence: { nCols: 1, maxScores: fill(new Int32Array(1), 4),
    obsValues: new Int32Array([2,3,3,2,1,2]),
    obsQuestIdx: new Int32Array([0,1,2,3,4,5]),
    obsColIdx: new Int32Array([0,0,0,0,0,0]) },
}
const layout = buildLayout(data)
const cuts = buildCutpoints(data)
const ws = makeWorkspace(layout)
precomputePartCounts(layout, data, ws)

const rng = new RNG(1)
const p = initParams(rng, layout)
const { logp, grad } = logpAndGrad(p, data, layout, cuts, ws)
console.log('logp:', logp.toFixed(6), 'dim:', layout.totalDim)

const h = 1e-5
let maxErr = 0, maxRel = 0
for (let i = 0; i < layout.totalDim; i++) {
  const orig = p[i]
  p[i] = orig + h
  const l1 = logpAndGrad(p, data, layout, cuts, ws).logp
  p[i] = orig - h
  const l2 = logpAndGrad(p, data, layout, cuts, ws).logp
  p[i] = orig
  const fd = (l1 - l2) / (2 * h)
  const err = fd - grad[i]
  const rel = Math.abs(fd) > 1e-6 ? Math.abs(err) / Math.abs(fd) : Math.abs(err)
  if (Math.abs(err) > Math.abs(maxErr)) maxErr = err
  if (rel > maxRel) maxRel = rel
  if (Math.abs(err) > 1e-3) {
    console.log(`param[${i}] analytical=${grad[i].toFixed(6)} fd=${fd.toFixed(6)} err=${err.toExponential(2)}`)
  }
}
console.log('max abs err:', maxErr.toExponential(3), 'max relative err:', maxRel.toExponential(3))
