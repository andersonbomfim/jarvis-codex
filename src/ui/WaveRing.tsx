import { useEffect, useRef } from 'react'
import { WAVE_SAMPLES, WAVE_STRANDS, WAVE_PALETTES, waveRingEnergy, waveRingOpacity, waveRingPoints } from './wave-ring'
type Props = { paused?: boolean; compact?: boolean; energy?: number; signal?: 'idle' | 'user' | 'jarvis' }

/** A continuous clock: microphone updates do not restart or throttle the animation. */
export function WaveRing({ paused = false, compact = false, energy = 0, signal = 'idle' }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), clock = useRef(0)
  const live = useRef({ energy, signal })
  useEffect(() => { live.current = { energy, signal } }, [energy, signal])
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const size = compact ? 192 : 512, points = new Float32Array((WAVE_SAMPLES + 1) * 2)
    // Leave room around the 128-unit emblem for expansion at the peaks of speech.
    ctx.setTransform(size / 144, 0, 0, size / 144, 0, 0)
    const gradients = Object.fromEntries(Object.entries(WAVE_PALETTES).map(([key, colors]) => {
      const gradient = ctx.createLinearGradient(48, 10, 80, 118)
      colors.forEach((color, i) => gradient.addColorStop(i / 3, color))
      return [key, gradient]
    })) as Record<NonNullable<Props['signal']>, CanvasGradient>
    let frame = 0, previous = performance.now(), strength = 0
    const paint = () => {
      ctx.setTransform(size / 144, 0, 0, size / 144, 0, 0); ctx.clearRect(0, 0, 144, 144); ctx.translate(8, 8)
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = gradients[live.current.signal]
      ctx.lineWidth = compact ? .55 : .29; ctx.lineJoin = 'round'
      for (let strand = 0; strand < WAVE_STRANDS; strand += compact ? 2 : 1) {
        waveRingPoints(strand, clock.current, strength, points)
        ctx.globalAlpha = waveRingOpacity(strand); ctx.beginPath(); ctx.moveTo(points[0], points[1])
        for (let i = 1; i <= WAVE_SAMPLES; i++) ctx.lineTo(points[i * 2], points[i * 2 + 1])
        ctx.closePath(); ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, .05); previous = now
      if (document.visibilityState === 'visible') {
        clock.current += delta
        strength = waveRingEnergy(strength, live.current.energy, delta)
        paint()
      }
      frame = requestAnimationFrame(tick)
    }
    paint(); if (!paused) frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [paused, compact])
  return <canvas ref={canvas} className="wave-ring-canvas" width={compact ? 192 : 512} height={compact ? 192 : 512} aria-label="Círculo de ondas neon entrelaçadas"/>
}
