import type { StanData, McmcSettings } from '../lib/types'
import { sample } from './sampler/hmc'
import { extractPosterior, serializePosterior } from './sampler/posterior'

interface RunPayload {
  type: 'run'
  data: StanData
  mcmc: McmcSettings
}

self.onmessage = (evt: MessageEvent<RunPayload>) => {
  const msg = evt.data
  if (msg.type !== 'run') return
  try {
    // Convert typed arrays that may have been serialized as regular arrays after
    // structured cloning: normalize participantIdx etc. to Int32Array.
    const data: StanData = {
      N: msg.data.N,
      T: msg.data.T,
      participantIdx: msg.data.participantIdx instanceof Int32Array
        ? msg.data.participantIdx
        : new Int32Array(msg.data.participantIdx as ArrayLike<number>),
      direct: {
        nCols: msg.data.direct.nCols,
        maxScores: msg.data.direct.maxScores instanceof Int32Array
          ? msg.data.direct.maxScores
          : new Int32Array(msg.data.direct.maxScores as ArrayLike<number>),
        obsValues: msg.data.direct.obsValues instanceof Int32Array
          ? msg.data.direct.obsValues
          : new Int32Array(msg.data.direct.obsValues as ArrayLike<number>),
        obsQuestIdx: msg.data.direct.obsQuestIdx instanceof Int32Array
          ? msg.data.direct.obsQuestIdx
          : new Int32Array(msg.data.direct.obsQuestIdx as ArrayLike<number>),
        obsColIdx: msg.data.direct.obsColIdx instanceof Int32Array
          ? msg.data.direct.obsColIdx
          : new Int32Array(msg.data.direct.obsColIdx as ArrayLike<number>),
      },
      fatigue: {
        nCols: msg.data.fatigue.nCols,
        maxScores: msg.data.fatigue.maxScores instanceof Int32Array
          ? msg.data.fatigue.maxScores
          : new Int32Array(msg.data.fatigue.maxScores as ArrayLike<number>),
        obsValues: msg.data.fatigue.obsValues instanceof Int32Array
          ? msg.data.fatigue.obsValues
          : new Int32Array(msg.data.fatigue.obsValues as ArrayLike<number>),
        obsQuestIdx: msg.data.fatigue.obsQuestIdx instanceof Int32Array
          ? msg.data.fatigue.obsQuestIdx
          : new Int32Array(msg.data.fatigue.obsQuestIdx as ArrayLike<number>),
        obsColIdx: msg.data.fatigue.obsColIdx instanceof Int32Array
          ? msg.data.fatigue.obsColIdx
          : new Int32Array(msg.data.fatigue.obsColIdx as ArrayLike<number>),
      },
      confidence: {
        nCols: msg.data.confidence.nCols,
        maxScores: msg.data.confidence.maxScores instanceof Int32Array
          ? msg.data.confidence.maxScores
          : new Int32Array(msg.data.confidence.maxScores as ArrayLike<number>),
        obsValues: msg.data.confidence.obsValues instanceof Int32Array
          ? msg.data.confidence.obsValues
          : new Int32Array(msg.data.confidence.obsValues as ArrayLike<number>),
        obsQuestIdx: msg.data.confidence.obsQuestIdx instanceof Int32Array
          ? msg.data.confidence.obsQuestIdx
          : new Int32Array(msg.data.confidence.obsQuestIdx as ArrayLike<number>),
        obsColIdx: msg.data.confidence.obsColIdx instanceof Int32Array
          ? msg.data.confidence.obsColIdx
          : new Int32Array(msg.data.confidence.obsColIdx as ArrayLike<number>),
      },
    }

    const t0 = performance.now()
    const combined = sample(data, {
      seed: msg.mcmc.seed,
      chains: msg.mcmc.chains,
      warmup: msg.mcmc.warmup,
      draws: msg.mcmc.draws,
      adaptDelta: msg.mcmc.adaptDelta,
      onProgress: (p) => {
        self.postMessage({
          type: 'progress',
          progress: {
            chain: 0,
            totalChains: msg.mcmc.chains,
            phase: p.phase,
            percent: (p.iter / p.total) * 100,
          },
        })
      },
    })

    const { draws, diagnostics } = extractPosterior(combined, data, msg.mcmc.seed)
    diagnostics.runtimeMs = performance.now() - t0
    self.postMessage({ type: 'done', result: serializePosterior(draws, diagnostics) })
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export {}
