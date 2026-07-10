// Mulberry32 seeded PRNG + Box-Muller normal
export class RNG {
  private state: number
  private spareNormal: number | null = null

  constructor(seed: number) {
    // ensure non-zero unsigned 32-bit seed
    this.state = (seed | 0) >>> 0
    if (this.state === 0) this.state = 0x9e3779b9
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  normal(): number {
    if (this.spareNormal !== null) {
      const s = this.spareNormal
      this.spareNormal = null
      return s
    }
    let u1 = 0
    while (u1 === 0) u1 = this.next()
    const u2 = this.next()
    const r = Math.sqrt(-2 * Math.log(u1))
    const t = 2 * Math.PI * u2
    this.spareNormal = r * Math.sin(t)
    return r * Math.cos(t)
  }

  fill(arr: Float64Array): void {
    for (let i = 0; i < arr.length; i++) arr[i] = this.normal()
  }
}
