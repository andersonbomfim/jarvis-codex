/** Shared geometry for the live emblem and its app icons, in a 128 × 128 frame. */
export const WAVE_STRANDS = 58
export const WAVE_SAMPLES = 160
export const VOICE_COLORS = { idle: '#54d2e7', user: '#ffab52', jarvis: '#ff453a' } as const
export const WAVE_PALETTES = {
  idle: ['#39f6ef', '#00c7fb', '#6770ff', '#733cdd'],
  user: ['#ffe8b8', '#ffc06a', '#ff913c', '#dc5d32'],
  jarvis: ['#ffd4cc', '#ff6a59', '#ff302e', '#c51035'],
} as const

/** Follow syllables quickly, then settle between phrases; independent of frame rate. */
export function waveRingEnergy(current: number, target: number, seconds: number) {
  const next = Number.isFinite(target) ? Math.max(0, Math.min(1, target)) : 0
  return current + (next - current) * (1 - Math.exp(-Math.max(0, seconds) * (next > current ? 24 : 9)))
}
export function waveRingPoints(strand: number, time: number, energy: number, out: Float32Array) {
  energy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0
  const phase = strand * .155, radius = 34 + strand * .365
  for (let i = 0; i <= WAVE_SAMPLES; i++) {
    const a = i / WAVE_SAMPLES * Math.PI * 2
    const wave = Math.sin(a * 7 + phase - time * .74) * 2.5 + Math.sin(a * 11 - phase * .72 + time * .43) * 1.2 + Math.sin(a * 3 + phase * .55 - time * .31) * 1.9
    const r = radius * (1 + energy * .1) + wave * (.72 + .28 * Math.sin(a - .8)) * (1 + energy * .85)
    out[i * 2] = 64 + Math.cos(a + time * .035) * r
    out[i * 2 + 1] = 64 + Math.sin(a + time * .035) * r
  }
  return out
}
export function waveRingOpacity(strand: number) { return .12 + .72 * Math.pow(1 - strand / WAVE_STRANDS, .65) }
