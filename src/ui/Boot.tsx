import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { CoreSignature } from './Holographics'

const STAGES = ['MONTAGEM DO NÚCLEO', 'COMPOSIÇÃO HOLOGRÁFICA', 'ABERTURA DA INTERFACE']

/** A visual assembly, independent of microphone permissions and paid voice services. */
export function Boot() {
  const phase = useStore(s => s.phase)
  const connected = useStore(s => s.connected)
  const [preview, setPreview] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const active = phase === 'boot' || preview
  useEffect(() => {
    const replay = () => { setElapsed(0); setPreview(true) }
    window.addEventListener('jarvis-preview-boot', replay)
    return () => window.removeEventListener('jarvis-preview-boot', replay)
  }, [])
  useEffect(() => {
    if (!active) { setElapsed(0); return }
    const started = Date.now()
    const timer = setInterval(() => {
      const time = Date.now()-started
      setElapsed(time)
      if (time >= 2800) { clearInterval(timer); setPreview(false) }
    },40)
    return () => clearInterval(timer)
  },[active])
  if (!active || elapsed >= 2800) return null
  const stage = Math.min(2,Math.floor(elapsed/800))
  return <div className="boot boot-assembly" role="status" aria-label="Inicialização holográfica do Jarvis">
    <div className="assembly-grid"/>
    <header className="assembly-header"><span>J.A.R.V.I.S.</span><span>PERSONAL INTELLIGENCE / USUÁRIO</span></header>
    <div className="assembly-center">
      <svg className="assembly-instrument" viewBox="-240 -240 480 480" fill="none" aria-hidden="true">
        <g className="assembly-ring ring-one"><circle r="215" strokeDasharray="150 35 8 35"/><circle r="202" strokeDasharray="1 8"/></g>
        <g className="assembly-ring ring-two"><circle r="174" strokeDasharray="90 20 5 20"/><circle r="158" strokeDasharray="8 6"/></g>
        <g className="assembly-reticle"><path d="M-232-110v-45h45M232-110v-45h-45M-232 110v45h45M232 110v45h-45"/><path d="M-218 0h70M218 0h-70M0-218v70M0 218v-70"/></g>
        {Array.from({length:36},(_,i)=><path className="assembly-tick" key={i} d="M0-187v10" transform={`rotate(${i*10})`} style={{animationDelay:`${i*.018}s`}}/>)}
        <g className="assembly-signature" transform="translate(-128 -128) scale(2)"><CoreSignature /></g>
      </svg>
      <div className="assembly-sweep"/>
      <div className="assembly-caption"><span>JARVIS</span><small>{STAGES[stage]}</small></div>
    </div>
    <div className="assembly-rails rail-a"><i/><i/><i/><i/><i/></div>
    <div className="assembly-rails rail-b"><i/><i/><i/><i/><i/></div>
    <footer className="assembly-footer">
      <div className="assembly-progress">{Array.from({length:42},(_,i)=><i key={i} className={i/42 < elapsed/2350 ? 'filled' : ''}/>)}</div>
      <div><span>INTERFACE / {String(stage+1).padStart(2,'0')}</span><span>{connected.length ? 'CONEXÃO ESTABELECIDA' : 'ESTABELECENDO CONEXÃO'}</span></div>
    </footer>
  </div>
}
