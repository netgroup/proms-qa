// Split-Rhat and bulk ESS following Vehtari et al. 2021 (simplified).
export function splitRhat(chains: Float64Array[]): number {
  const M = chains.length
  const N = chains[0].length
  if (M < 2 || N < 4) return NaN
  const halfN = Math.floor(N / 2)
  const splits: number[][] = []
  for (const c of chains) {
    splits.push(Array.from(c.subarray(0, halfN)))
    splits.push(Array.from(c.subarray(halfN, halfN * 2)))
  }
  const K = splits.length
  const n = halfN
  const means = splits.map((s) => mean(s))
  const grandMean = mean(means)
  let B = 0
  for (const m of means) B += (m - grandMean) * (m - grandMean)
  B = (n / (K - 1)) * B
  let W = 0
  for (let k = 0; k < K; k++) {
    const m = means[k]
    let s = 0
    for (const v of splits[k]) s += (v - m) * (v - m)
    W += s / (n - 1)
  }
  W /= K
  const varHat = ((n - 1) / n) * W + B / n
  if (W <= 0) return 1
  return Math.sqrt(varHat / W)
}

function mean(a: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s / a.length
}

// Simple ESS estimate via lag-1 autocorrelation (rough bulk ESS proxy).
export function ess(chains: Float64Array[]): number {
  const M = chains.length
  const N = chains[0].length
  if (M < 1 || N < 4) return NaN
  const total = M * N
  let sumAcf = 0
  for (const c of chains) {
    const m = mean(c)
    let num = 0
    let den = 0
    for (let i = 0; i < N; i++) den += (c[i] - m) * (c[i] - m)
    for (let i = 0; i < N - 1; i++) num += (c[i] - m) * (c[i + 1] - m)
    if (den > 0) sumAcf += num / den
  }
  const rho1 = sumAcf / M
  const tau = 1 + 2 * Math.max(0, rho1)
  return total / Math.max(tau, 1)
}
