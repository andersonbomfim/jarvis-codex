/** Shared geometry for the live emblem and its app icons, in a 128 × 128 frame. */
export const WAVE_STRANDS = 58
export const WAVE_SAMPLES = 160
export function waveRingPoints(strand: number, time: number, energy: number, out: Float32Array) {
  const phase = strand * .155, radius = 34 + strand * .365
  for (let i = 0; i <= WAVE_SAMPLES; i++) {
    const a = i / WAVE_SAMPLES * Math.PI * 2
    const wave = Math.sin(a * 7 + phase - time * .74) * 2.5 + Math.sin(a * 11 - phase * .72 + time * .43) * 1.2 + Math.sin(a * 3 + phase * .55 - time * .31) * 1.9
    const r = radius + wave * (.72 + .28 * Math.sin(a - .8)) * (1 + energy * .7)
    out[i * 2] = 64 + Math.cos(a + time * .035) * r
    out[i * 2 + 1] = 64 + Math.sin(a + time * .035) * r
  }
  return out
}
export function waveRingOpacity(strand: number) { return .12 + .72 * Math.pow(1 - strand / WAVE_STRANDS, .65) }
