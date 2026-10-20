import { useEffect, useRef } from 'react'
import { WAVE_SAMPLES, WAVE_STRANDS, waveRingOpacity, waveRingPoints } from './wave-ring'
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
    ctx.setTransform(size / 128, 0, 0, size / 128, 0, 0)
    const palettes = { idle: ['#39f6ef', '#00c7fb', '#6770ff', '#733cdd'], user: ['#ffe8b8', '#ffc06a', '#ff913c', '#dc5d32'], jarvis: ['#c3ffff', '#5de6ff', '#259fff', '#6379ff'] }
    const gradients = Object.fromEntries(Object.entries(palettes).map(([key, colors]) => {
      const gradient = ctx.createLinearGradient(48, 10, 80, 118)
      colors.forEach((color, i) => gradient.addColorStop(i / 3, color))
      return [key, gradient]
    })) as Record<NonNullable<Props['signal']>, CanvasGradient>
    let frame = 0, previous = performance.now(), strength = 0
    const paint = () => {
      ctx.setTransform(size / 128, 0, 0, size / 128, 0, 0); ctx.clearRect(0, 0, 128, 128)
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
        strength += (Math.min(1, live.current.energy) - strength) * (1 - Math.exp(-delta * 8))
        paint()
      }
      frame = requestAnimationFrame(tick)
    }
    paint(); if (!paused) frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [paused, compact])
  return <canvas ref={canvas} className="wave-ring-canvas" width={compact ? 192 : 512} height={compact ? 192 : 512} aria-label="Círculo de ondas neon entrelaçadas"/>
}
