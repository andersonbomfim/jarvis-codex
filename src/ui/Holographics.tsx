import { memo, useEffect, useRef } from 'react'
import { WaveRing } from './WaveRing'

export function CoreSignature(props: Parameters<typeof WaveRing>[0]) {
  return <foreignObject x="0" y="0" width="128" height="128"><WaveRing {...props}/></foreignObject>
}

export function JarvisMark({ className = '', paused = false }: { className?: string; paused?: boolean }) {
  return <svg className={className} viewBox="0 0 128 128" fill="none" aria-label="Símbolo do Jarvis" role="img">
    <CoreSignature compact paused={paused}/>
  </svg>
}

const points = [[36,60],[78,27],[132,49],[185,24],[234,63],[210,112],[155,96],[100,135],[47,116],[143,164],[220,166],[61,184]]
const links = [[0,1],[0,8],[1,2],[1,7],[2,3],[2,6],[3,4],[4,5],[5,6],[5,10],[6,7],[6,9],[7,8],[7,9],[8,11],[9,10],[9,11],[2,7],[4,6]]

function NeuralMatrix({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const meter = useRef<HTMLSpanElement>(null)
  const elapsed = useRef(0)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d', { alpha: true })
    if (!ctx) return
    let frame = 0, previous = performance.now(), sampleStart = previous, frames = 0
    const paint = () => {
      const t=elapsed.current, yaw=t*.65, pitch=Math.sin(t*.45)*.45
      const cy=Math.cos(yaw), sy=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch)
      const projected=points.map(([x,y],i) => {
        const px=x-135, py=y-110, pz=Math.sin(i*2.4)*65
        const rx=px*cy+pz*sy, rz=-px*sy+pz*cy
        const ry=py*cp-rz*sp, depth=py*sp+rz*cp, scale=380/(380+depth)
        return [135+rx*scale,110+ry*scale,scale]
      })
      ctx.setTransform(2,0,0,2,0,0)
      ctx.clearRect(0,0,270,220)
      ctx.lineWidth=.7; ctx.strokeStyle='#64c4e04d'
      ctx.setLineDash([2,5]); ctx.beginPath(); ctx.ellipse(135,110,118,87,0,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([])
      ctx.strokeStyle='#78d4ed99'; ctx.lineWidth=.9; ctx.beginPath()
      links.forEach(([a,b]) => { ctx.moveTo(projected[a][0],projected[a][1]); ctx.lineTo(projected[b][0],projected[b][1]) })
      ctx.stroke()
      projected.forEach(([x,y,scale]) => {
        ctx.strokeStyle='#75ddf447'; ctx.lineWidth=.65
        ctx.beginPath(); ctx.arc(x,y,8*scale,0,Math.PI*2); ctx.stroke()
        ctx.fillStyle='#b6f4ff'
        ctx.beginPath(); ctx.arc(x,y,2.6*scale,0,Math.PI*2); ctx.fill()
      })
      ctx.strokeStyle='#e8b56b88'; ctx.lineWidth=.6
      ctx.beginPath(); const scan=110+Math.sin(t*1.3)*77; ctx.moveTo(18,scan); ctx.lineTo(250,scan); ctx.stroke()
      ctx.strokeStyle='#a6e2f066'
      ctx.beginPath(); ctx.moveTo(18,16);ctx.lineTo(18,28);ctx.moveTo(12,22);ctx.lineTo(24,22);ctx.moveTo(248,192);ctx.lineTo(248,204);ctx.moveTo(242,198);ctx.lineTo(254,198);ctx.stroke()
    }
    paint()
    if (paused) { if(meter.current) meter.current.textContent='PAUSADO'; return }
    const render=(now: number) => {
      frame=requestAnimationFrame(render)
      const delta=now-previous; previous=now
      if (document.visibilityState!=='visible') { sampleStart=now; frames=0; return }
      elapsed.current+=Math.min(delta/1000,.05)
      paint()
      frames++
      if(now-sampleStart>=600) {
        if(meter.current) meter.current.textContent=Math.round(frames*1000/(now-sampleStart))+' FPS'
        sampleStart=now; frames=0
      }
    }
    frame=requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  },[paused])
  return <div className="neural-display"><canvas ref={canvas} className="neural-canvas" width={540} height={440} aria-label="Malha neural em rotação"/><span ref={meter} className="neural-fps">…</span></div>
}

/** Decorative instrument drawings; no invented CPU, news or security readings. */
export const HoloDeck = memo(function HoloDeck({ paused }: { paused: boolean }) {
  return <div className="holo-deck" aria-hidden="true">
    <svg className="holo-connections" viewBox="0 0 1600 900" preserveAspectRatio="none" fill="none">
      <path d="M30 170h280l80 80h120M30 730h280l80-80h120M1570 170h-280l-80 80h-120M1570 730h-280l-80-80h-120"/>
      <path className="trace-signal" d="M30 170h280l80 80h120M1570 730h-280l-80-80h-120"/>
      <path d="M560 112h160l20 18h120l20-18h160M560 768h160l20-18h120l20 18h160"/>
    </svg>
    <aside className="holo-wing wing-left">
      <section className="holo-module neural-module">
        <div className="holo-label"><span>01 / MATRIZ NEURAL</span><i>N—01</i></div>
        <NeuralMatrix paused={paused}/>
        <div className="holo-code"><span>NX / COGNITIVE ARRAY</span><span>∴ ∴ ∴</span></div>
      </section>
      <section className="holo-module spectrum-module">
        <div className="holo-label"><span>02 / FLUXO DE SINAL</span><i>Σ</i></div>
        <div className="holo-spectrum">{Array.from({length:48},(_,i)=><i key={i} style={{'--bar':`${15+Math.abs(Math.sin(i*1.73))*75}%`,'--delay':`${-i*.13}s`} as React.CSSProperties}/>)}</div>
        <svg className="holo-waveform" viewBox="0 0 270 45" fill="none"><path d="M0 23h25l5-8 8 18 5-11h32l5-18 7 38 8-30 5 11h30l6-8 8 17 5-9h27l6-21 8 40 6-32 7 13h47l6-8 7 16 5-8h15"/></svg>
        <div className="holo-code"><span>FREQUENCY / VISUAL</span><span>Ⅰ Ⅱ Ⅲ</span></div>
      </section>
      <div className="holo-side-caption">A N D E R S O N <span>PERSONAL SYSTEM</span></div>
    </aside>
    <aside className="holo-wing wing-right">
      <section className="holo-module orbit-module">
        <div className="holo-label"><span>03 / PROJEÇÃO ESPACIAL</span><i>O—03</i></div>
        <svg viewBox="0 0 270 220" fill="none">
          <g className="orbital-grid"><circle cx="135" cy="110" r="85"/><ellipse cx="135" cy="110" rx="85" ry="32"/><ellipse cx="135" cy="110" rx="85" ry="62"/><ellipse cx="135" cy="110" rx="32" ry="85"/><ellipse cx="135" cy="110" rx="62" ry="85"/><path d="M38 110h194M135 13v194"/></g>
          <g className="orbital-spin"><ellipse cx="135" cy="110" rx="108" ry="36" transform="rotate(-32 135 110)"/><circle cx="228" cy="58" r="4"/></g>
          <g className="orbital-spin orbital-reverse"><ellipse cx="135" cy="110" rx="100" ry="42" transform="rotate(43 135 110)"/><circle cx="68" cy="44" r="3"/></g>
          <circle className="orbital-core" cx="135" cy="110" r="5"/>
          <path className="instrument-hairline" d="M25 30h30M25 30v30M245 190h-30M245 190v-30"/>
        </svg>
        <div className="holo-code"><span>VECTOR FIELD / XYZ</span><span>⌖</span></div>
      </section>
      <section className="holo-module alignment-module">
        <div className="holo-label"><span>04 / ALINHAMENTO</span><i>Δ</i></div>
        {[0,1,2,3].map(i=><div className="alignment-track" key={i}><span>{['α','β','γ','δ'][i]}</span><div><i style={{animationDelay:`${-i*1.7}s`}}/></div><b>{['AX / 01','AY / 02','AZ / 03','Ω / 04'][i]}</b></div>)}
        <div className="holo-code"><span>HOLOGRAPHIC INTERFACE</span><span>┆┆┆</span></div>
      </section>
      <div className="holo-side-caption">J A R V I S <span>COGNITIVE CORE</span></div>
    </aside>
    <div className="holo-reticle reticle-tl"/><div className="holo-reticle reticle-tr"/><div className="holo-reticle reticle-bl"/><div className="holo-reticle reticle-br"/>
  </div>
})
