import { useClientProfile } from '../lib/profile'
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, accentFor } from '../store'
import { BRIDGE_HTTP_URL } from '../config'
import { audioEnabled, chats, currentId, openConversation, selectedEffort, TEXT_ONLY } from '../lib/sessions'
import { microphoneStatus, startAnalyser, selectMicrophone } from '../lib/audio'
import { caps } from '../lib/capabilities'
import { HoloDeck, JarvisMark, CoreSignature } from './Holographics'
import { hasDesktopWindow, closeDesktopWindow } from '../lib/desktop'
import { isFixedPhrase } from '../lib/assistant-cache'
import { VOICE_COLORS, voiceSignal } from './wave-ring'

const STATUS = { offline: 'AGUARDANDO SEU COMANDO', boot: 'INICIALIZANDO VOZ', dormant: 'À SUA DISPOSIÇÃO', waking: 'ESTOU OUVINDO', listening: 'ESTOU OUVINDO', thinking: 'ANALISANDO O PEDIDO', tooling: 'EXECUTANDO', speaking: 'RESPONDENDO' }
const MODULES = [
  { key: 'research', name: 'PESQUISAR', sub: 'Fontes, análise e comparações', glyph: '⌕', prompt: 'Pesquise a fundo sobre ' },
  { key: 'computer', name: 'COMPUTADOR', sub: 'Aplicativos, sistema e tela', glyph: '⌘', prompt: 'Mostre o estado real do computador, com memória e programas em execução.' },
  { key: 'documents', name: 'DOCUMENTOS', sub: 'PDF, Word e planilhas', glyph: '▤', prompt: 'Analise o arquivo anexado e prepare um relatório completo com os principais pontos.' },
  { key: 'browser', name: 'NAVEGAR', sub: 'Páginas, buscas e formulários', glyph: '◎', prompt: 'Abra o navegador e ' },
  { key: 'code', name: 'PROGRAMAR', sub: 'Construir, corrigir e testar', glyph: '⌁', prompt: 'Me ajude a implementar e testar ' },
  { key: 'memory', name: 'MEMÓRIA', sub: 'Preferências e projetos', glyph: '◇', prompt: 'Consulte sua memória e mostre o que você lembra sobre minhas preferências e projetos.' },
]
type Machine = { cpu: string; cpuPercent: number; cores: number; ramUsed: number; ramTotal: number; uptime: number }
type Attachment = { name: string; path: string; size: number }
type Output = { name: string; size: number; modified: string }
const gb = (n: number) => (n / 1024 ** 3).toFixed(1)
const displayText = (text: string) => text.replace(/:codex-[\w-]+\{[^}]*\}/g, '').replace(/:codex-[\w-]+\{[^}]*$/g, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim()

const Reactor = memo(function Reactor({ paused }: { paused: boolean }) {
  const phase = useStore(s => s.phase), output = useStore(s => s.outputLevel), ui = useStore(s => s.ui)
  const talking = useStore(s => s.assistantSpeaking), input = useStore(s => s.micLevel)
  const signal = voiceSignal(phase, talking, input)
  const level = signal === 'jarvis' ? output : signal === 'user' ? input : 0
  const color = signal === 'idle' ? ui.reactor.color || VOICE_COLORS.idle : VOICE_COLORS[signal]
  return <div className={`reactor-shell state-${phase} signal-${signal} style-${ui.reactor.style}`} data-signal={signal} style={{ '--power': Math.max(.04, level), '--reactor-scale': ui.reactor.scale, '--reactor-duration': `${16 / Math.max(.01, ui.reactor.spin)}s`, '--reactor-play': ui.reactor.spin === 0 ? 'paused' : 'running', '--reactor-brightness': ui.reactor.intensity, color, opacity: ui.reactor.visible ? 1 : 0 } as React.CSSProperties} aria-hidden="true">
    <svg className="reactor-instrument" viewBox="0 0 520 520" fill="none">
      <defs><radialGradient id="reactorGlow"><stop stopColor="currentColor" stopOpacity=".28"/><stop offset=".65" stopColor="currentColor" stopOpacity=".06"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></radialGradient><linearGradient id="reactorLine"><stop stopColor="currentColor" stopOpacity=".03"/><stop offset=".5" stopColor="currentColor"/><stop offset="1" stopColor="currentColor" stopOpacity=".03"/></linearGradient></defs>
      <circle cx="260" cy="260" r="240" fill="url(#reactorGlow)"/>
      <g className="reactor-outer"><circle cx="260" cy="260" r="238" stroke="currentColor" strokeOpacity=".18"/>
        {Array.from({ length: 120 }, (_, i) => <path key={i} d={`M260 ${i % 5 === 0 ? 12 : 17}v${i % 5 === 0 ? 16 : 6}`} stroke="currentColor" strokeWidth={i % 5 === 0 ? 2 : 1} strokeOpacity={i % 5 === 0 ? .8 : .28} transform={`rotate(${i * 3} 260 260)`}/>)}
      </g>
      <g className="reactor-arc"><circle cx="260" cy="260" r="213" stroke="currentColor" strokeWidth="3" strokeDasharray="148 60 30 96 190 130 75 145 32 145"/><circle cx="260" cy="260" r="203" stroke="currentColor" strokeOpacity=".26" strokeDasharray="2 6"/></g>
      <g className="reactor-reverse"><circle cx="260" cy="260" r="186" stroke="currentColor" strokeWidth="7" strokeOpacity=".16" strokeDasharray="18 3"/><circle cx="260" cy="260" r="176" stroke="currentColor" strokeWidth="1.4" strokeDasharray="220 60 94 180"/></g>
      <g className="reactor-sphere"><circle cx="260" cy="260" r="139" stroke="currentColor" strokeOpacity=".4"/>{[0, 60, 120].map(a => <ellipse key={a} cx="260" cy="260" rx="139" ry="48" stroke="currentColor" strokeOpacity=".3" transform={`rotate(${a} 260 260)`}/>)}</g>
      <circle className="reactor-breath" cx="260" cy="260" r={157 + level * 27} stroke="currentColor" strokeWidth={1 + level * 3} strokeOpacity={.32 + level * .5}/>
      <path d="M95 260H143M377 260H425M260 95V143M260 377V425" stroke="currentColor" strokeOpacity=".6"/>
      <g className="reactor-emblem" transform="translate(100 100) scale(2.5)"><CoreSignature paused={paused} signal={signal} energy={level}/></g>
      <text x="260" y="237" textAnchor="middle" className="reactor-svg-caption">PERSONAL INTELLIGENCE</text>
      <text x="260" y="272" textAnchor="middle" className="reactor-svg-name">JARVIS</text>
      <text x="260" y="299" textAnchor="middle" className="reactor-svg-caption">{TEXT_ONLY ? 'AGUARDANDO SEU COMANDO' : talking ? 'JARVIS FALANDO' : signal === 'user' ? 'CAPTANDO SUA VOZ' : phase === 'offline' ? 'SISTEMA DISPONÍVEL' : 'AGUARDANDO SUA VOZ'}</text>
      <g className="reactor-cross"><path d="M62 49V62H49M458 49V62H471M62 471V458H49M458 471V458H471" stroke="currentColor" strokeOpacity=".4"/></g>
    </svg>
    <div className="reactor-wave">{Array.from({ length: 37 }, (_, i) => <i key={i} style={{ height: `${3 + Math.abs(Math.sin(i * 2.3)) * (5 + level * 26)}px`, opacity: .3 + Math.abs(Math.sin(i)) * .65 }}/>)}</div>
    <span className="reactor-coordinate coord-a">SYS / 01</span><span className="reactor-coordinate coord-b">{STATUS[phase]}</span>
  </div>
})

function VoiceMonitor() {
  const level = useStore(s => s.micLevel), ready = useStore(s => s.voiceReady), caption = useStore(s => s.caption)
  const [status, setStatus] = useState(microphoneStatus())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [heard, setHeard] = useState(''), [failure, setFailure] = useState('')
  const [engine, setEngine] = useState(''), [transcribing, setTranscribing] = useState(false)
  useEffect(() => {
    const update = () => {
      setStatus(microphoneStatus())
      const d = (window as unknown as { __voice?: { heard: string; lastError: string; engine: string; transcribing?: boolean } }).__voice
      setHeard(d?.heard || ''); setFailure(d?.lastError || ''); setEngine(d?.engine || ''); setTranscribing(Boolean(d?.transcribing))
    }
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(all => setDevices(all.filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications'))).catch(() => {}) }
    update(); refresh(); const timer = setInterval(update, 250)
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => { clearInterval(timer); navigator.mediaDevices?.removeEventListener('devicechange', refresh) }
  }, [ready])
  return <div className="voice-monitor">
    <div className="microphone-meter" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><i style={{ width: `${level * 100}%` }}/></div>
    <div className="microphone-signal">{!status.live ? 'MICROFONE FECHADO' : status.context !== 'running' ? 'ÁUDIO PAUSADO' : status.muted ? 'MICROFONE SEM SINAL' : level > .08 ? 'SOM SENDO CAPTADO' : 'MICROFONE ABERTO · SILÊNCIO'}</div>
    <label className="microphone-choice">ENTRADA <select aria-label="Microfone de entrada" value={localStorage.getItem('jarvis.microphone.mode') === 'manual' ? localStorage.getItem('jarvis.microphone') || 'default' : 'webcam'} onChange={e => { selectMicrophone(e.target.value, e.target.selectedOptions[0]?.text || ''); location.reload() }}><option value="webcam">Microfone do sistema (automático)</option><option value="default">Padrão do Windows</option>{devices.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>)}</select></label>
    {status.live && <span className="microphone-device">{status.label}</span>}
    <span className={`recognition-state ${failure ? 'failed' : ''}`}>{failure ? 'FALHA NA TRANSCRIÇÃO' : transcribing ? 'TRANSCREVENDO…' : ready ? engine === 'local' ? 'RECONHECIMENTO LOCAL · PT-BR' : 'RECONHECIMENTO ATIVO · PT-BR' : 'INICIANDO RECONHECIMENTO…'}</span>
    {status.live && status.context !== 'running' && <button onClick={() => void startAnalyser()}>RETOMAR ÁUDIO</button>}
    <p className="heard-preview"><b>{caption && caption !== '…' ? 'OUVINDO' : 'ÚLTIMO TRECHO'}</b>{caption && caption !== '…' ? caption : heard || 'O que você disser aparecerá aqui.'}</p>
    <div className="voice-legend"><span>● Você · laranja</span><span>● Jarvis · vermelho</span></div>
  </div>
}

function SpeakerControls({ onTest, disabled }: { onTest: () => void; disabled: boolean }) {
  const ready = useStore(s => s.voiceReady)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [sink, setSink] = useState(localStorage.getItem('jarvis.speaker') || '')
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const refresh = () => { void navigator.mediaDevices?.enumerateDevices().then(all => setDevices(all.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications'))).catch(() => {}) }
    refresh(); const tick = setInterval(() => setPlaying(useStore.getState().assistantSpeaking), 150)
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => { clearInterval(tick); navigator.mediaDevices?.removeEventListener('devicechange', refresh) }
  }, [ready])
  return <div className="speaker-controls">
    <label>SAÍDA DE SOM <select aria-label="Saída de som" value={sink} onChange={e => { setSink(e.target.value); localStorage.setItem('jarvis.speaker', e.target.value) }}><option value="">Padrão do Windows</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Saída ${i + 1}`}</option>)}</select></label>
    <button type="button" aria-label="Testar voz" onClick={onTest} disabled={disabled || playing}>{playing ? 'REPRODUZINDO VOZ…' : '▶ TESTAR VOZ'}</button>
  </div>
}

export function Console({ onSend, onStart, onStop, onTestVoice, onRead, onMute }: { onSend: (text: string) => void; onStart: () => void; onStop: () => void; onTestVoice: () => void; onRead: (text: string) => void; onMute: () => void }) {
  const phase = useStore(s => s.phase), turns = useStore(s => s.turns), tool = useStore(s => s.activeTool)
  const connected = useStore(s => s.connected), error = useStore(s => s.error), reportedReady = useStore(s => s.voiceReady), ui = useStore(s => s.ui)
  const profile = useClientProfile()
  const [captureReady, setCaptureReady] = useState(false)
  const voiceReady = reportedReady && captureReady
  useEffect(() => {
    const update = () => { const mic = microphoneStatus(); setCaptureReady(Boolean(mic.live && mic.enabled && !mic.muted && mic.context === 'running')) }
    update(); const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [])
  const [motionPaused, setMotionPaused] = useState(localStorage.getItem('jarvis.motion.v2') === 'paused')
  const [draft, setDraft] = useState(''), [attachments, setAttachments] = useState<Attachment[]>([])
  const [tray, setTray] = useState<'modules' | 'history' | 'outputs' | 'settings' | null>(null)
  const [machine, setMachine] = useState<Machine | null>(null), [outputs, setOutputs] = useState<Output[]>([])
  const [clock, setClock] = useState(new Date()), [uploading, setUploading] = useState(false), [notice, setNotice] = useState('')
  const [muted, setMuted] = useState(!audioEnabled()), [effort, setEffort] = useState(selectedEffort())
  const [actions, setActions] = useState<{ name: string; time: string }[]>([])
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const input = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null), transcript = useRef<HTMLDivElement>(null)
  const busy = ['thinking', 'tooling', 'speaking'].includes(phase)
  useEffect(() => {
    const sync = () => setMuted(!audioEnabled())
    window.addEventListener('jarvis-audio-change', sync)
    return () => window.removeEventListener('jarvis-audio-change', sync)
  }, [])
  useEffect(() => {
    const update = () => {
      void fetch(`${BRIDGE_HTTP_URL}/status`).then(r => { if (!r.ok) throw new Error(); return r.json() }).then(setMachine).catch(() => setMachine(null))
      void fetch(`${BRIDGE_HTTP_URL}/outputs`).then(r => r.json()).then(data => { if (Array.isArray(data)) setOutputs(data) }).catch(() => {})
    }
    update(); const id = setInterval(update, 6000); const tick = setInterval(() => setClock(new Date()), 1000)
    return () => { clearInterval(id); clearInterval(tick) }
  }, [])
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }) }, [turns])
  useEffect(() => {
    if (!tool) return
    setActions(previous => [{ name: tool, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }, ...previous].slice(0, 5))
  }, [tool])
  useEffect(() => { if (!busy) setStartedAt(null) }, [busy])
  const upload = async (files: FileList | null) => {
    if (!files) return
    setUploading(true); setNotice('')
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 ** 2) throw new Error(`${file.name}: limite de 25 MB.`)
        const response = await fetch(`${BRIDGE_HTTP_URL}/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Não foi possível anexar.')
        setAttachments(previous => [...previous, result].slice(-8))
      }
    } catch (e) { setNotice((e as Error).message) } finally { setUploading(false); if (picker.current) picker.current.value = '' }
  }
  const send = () => {
    if (!draft.trim() || uploading) return
    const files = attachments.length ? '\n\nArquivos anexados para esta tarefa:\n' + attachments.map(a => `${a.name}: ${a.path}`).join('\n') : ''
    onSend(draft.trim() + files); setDraft(''); setAttachments([]); setActions([]); setStartedAt(Date.now()); setTray(null)
  }
  const module = (prompt: string) => { setDraft(prompt); setTray(null); input.current?.focus() }
  const toggleAudio = () => { const next = !muted; setMuted(next); localStorage.setItem('jarvis.audio', next ? 'off' : 'on'); if (next) onMute() }
  const fullscreen = () => { const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); void request.catch(() => setNotice('Use F11 para tela cheia.')) }
  const name = (raw: string) => raw.replace(/^mcp__/, '').replace(/__/g, ' / ').replace(/[_-]/g, ' ')
  const modules = [
    { title: 'Windows', ready: connected.includes('windows'), detail: 'Aplicativos e sistema' },
    { title: 'Navegador', ready: connected.includes('chrome-devtools'), detail: 'Páginas e ações' },
    { title: 'Arquivos', ready: connected.includes('files'), detail: 'Leitura e documentos' },
    { title: 'Memória', ready: connected.includes('memory'), detail: 'Preferências persistentes' },
    { title: 'Visão', ready: connected.includes('jarvis_eyes'), detail: 'Sob seu comando' },
  ]
  return createPortal(<div className={`jarvis-console ${busy ? 'is-working' : ''} ${motionPaused ? 'motion-paused' : ''}`}  style={{ '--accent': accentFor(phase, ui) } as React.CSSProperties} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files) }}>
    <div className="holo-grid"/>
    <header className="console-header">
      <div className="console-identity"><JarvisMark className="identity-emblem" paused={motionPaused}/><div><span className="identity-mark">J<span>·</span>A<span>·</span>R<span>·</span>V<span>·</span>I<span>·</span>S</span><span className="identity-sub">PERSONAL INTELLIGENCE / {profile.displayName.toUpperCase()}</span></div></div>
      <div className="connection-indicator"><i className={connected.length ? 'live' : ''}/>{connected.length ? 'SISTEMA CONECTADO' : 'CONECTANDO'}</div>
      <div className="console-header-actions"><button aria-label={motionPaused ? "Ativar animação" : "Pausar animação"} title={motionPaused ? "Ativar animação" : "Pausar animação"} onClick={() => { setMotionPaused(!motionPaused); localStorage.setItem("jarvis.motion.v2", !motionPaused ? "paused" : "running") }}>◌</button><time>{clock.toLocaleTimeString('pt-BR', { timeZone: profile.timezone, hour: '2-digit', minute: '2-digit' })}</time><button title="Configurações" aria-label="Configurações" onClick={() => setTray(tray === 'settings' ? null : 'settings')}>⚙</button><button title="Conversas salvas" aria-label="Conversas salvas" onClick={() => setTray(tray === 'history' ? null : 'history')}>◷</button><button title="Tela cheia" aria-label="Tela cheia" onClick={fullscreen}>⛶</button>{hasDesktopWindow() && <button className="window-close" title="Fechar Jarvis (Esc)" aria-label="Fechar Jarvis" onClick={closeDesktopWindow}>×</button>}</div>
    </header>

    <Reactor paused={motionPaused}/>
    {!TEXT_ONLY && !voiceReady && <button className="core-activate" onClick={onStart} disabled={phase === 'boot'}>{phase === 'boot' ? 'ABRINDO CANAL DE VOZ' : 'ATIVAR JARVIS'}<span>{phase === 'boot' ? 'Aguarde a inicialização' : 'Clique para conversar'}</span></button>}

    <HoloDeck paused={motionPaused}/>

    <div className="mission-state"><span className={`mission-dot ${busy ? 'busy' : ''}`}/><b>{STATUS[phase]}</b>{busy && startedAt && <time>{Math.max(0, Math.floor((clock.getTime() - startedAt) / 1000))}s</time>}{busy && <button onClick={onStop}>INTERROMPER □</button>}</div>
    {ui.chrome.transcript && <div className="conversation-stream" ref={transcript} aria-live="polite">{turns.length ? turns.slice(-12).map(t => <div className={`conversation-line from-${t.role}`} key={t.id}><span>{t.role === 'jarvis' ? 'JARVIS' : 'VOCÊ'}{t.role === 'jarvis' && (isFixedPhrase(displayText(t.text)) || t.id.startsWith('morning-')) && <button className="read-response" aria-label="Ouvir esta resposta" title="Ouvir esta resposta" disabled={busy} onClick={() => onRead(displayText(t.text))}>▶ OUVIR</button>}</span><p>{displayText(t.text.split('\n\nArquivos anexados para esta tarefa:')[0])}</p></div>) : <div className="conversation-empty"><p>Estou aqui. O que vamos fazer?</p><span>Fale comigo, digite um pedido ou arraste um arquivo.</span></div>}</div>}

    <div className="command-dock">
      {attachments.length > 0 && <div className="attachment-strip">{attachments.map((a, i) => <button key={a.path} title="Remover anexo" onClick={() => setAttachments(previous => previous.filter((_, n) => n !== i))}>▤ {a.name}<span>×</span></button>)}</div>}
      <form className="command-form" onSubmit={e => { e.preventDefault(); send() }}>
        <button type="button" className="dock-icon" aria-label="Anexar arquivos" title="Anexar arquivos" onClick={() => picker.current?.click()} disabled={uploading}>{uploading ? '…' : '+'}</button>
        <textarea ref={input} aria-label="Comando para Jarvis" placeholder="Jarvis, preciso que você…" rows={1} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}/>
        <button type="button" className="dock-icon voice-button" aria-label="Ativar voz" title={TEXT_ONLY ? 'Voz e microfone desativados nesta janela' : 'Ativar conversa por voz'} onClick={onStart} disabled={TEXT_ONLY || voiceReady || phase === 'boot'}>◉</button>
        <button type="submit" className="send-command" aria-label="Enviar comando" disabled={!draft.trim() || uploading}>↗</button>
      </form>
      <input ref={picker} type="file" multiple hidden onChange={e => void upload(e.target.files)}/>
      <div className="dock-meta"><button onClick={() => { setTray(tray === 'outputs' ? null : 'outputs') }}>ENTREGAS {outputs.length > 0 && <b>{outputs.length}</b>}</button><label>RACIOCÍNIO <select aria-label="Nível de raciocínio" value={effort} onChange={e => { setEffort(e.target.value); localStorage.setItem('jarvis.effort', e.target.value) }}><option value="low">Rápido</option><option value="medium">Equilibrado</option><option value="high">Profundo</option></select></label><button onClick={toggleAudio} disabled={TEXT_ONLY}>{TEXT_ONLY ? 'MODO TEXTO' : muted ? 'VOZ SILENCIADA' : 'FRASES COM VOZ'}</button></div>
    </div>

    {(notice || error) && <div className="console-notice" role="alert"><span>{notice || error}</span><button aria-label="Fechar aviso" onClick={() => { setNotice(''); useStore.getState().setError(null) }}>×</button></div>}
    {tray && <div className="console-tray"><header><span>{tray === 'modules' ? 'O QUE VAMOS FAZER?' : tray === 'history' ? 'CONVERSAS SALVAS NESTE COMPUTADOR' : tray === 'settings' ? 'CONFIGURAÇÕES DO SISTEMA' : 'ARQUIVOS PRODUZIDOS'}</span><button aria-label="Fechar painel" onClick={() => setTray(null)}>×</button></header>
      {tray === 'settings' && <div className="technical-settings">    <aside className="telemetry-cluster">
      <div className="instrument-heading"><span>01</span> TELEMETRIA LOCAL</div>
      <div className="telemetry-main"><b>{machine ? machine.cpuPercent : '—'}<small>%</small></b><span>PROCESSADOR</span></div>
      <div className="instrument-bar"><i style={{ width: `${machine?.cpuPercent ?? 0}%` }}/></div>
      <p className="processor-name">{machine?.cpu || 'Aguardando dados do computador'}</p>
      <div className="memory-readout"><span>MEMÓRIA</span><b>{machine ? `${gb(machine.ramUsed)} / ${gb(machine.ramTotal)} GB` : '—'}</b></div>
      <div className="instrument-bar"><i style={{ width: `${machine ? machine.ramUsed / machine.ramTotal * 100 : 0}%` }}/></div>
      <div className="instrument-separator"/>
      <div className="instrument-heading"><span>02</span> CANAL DE VOZ</div>
      <div className={`voice-indicator ${voiceReady ? 'live' : ''}`}><i/>{voiceReady ? 'ESCUTA ATIVADA' : 'MICROFONE DESATIVADO'}</div>
      <VoiceMonitor />
      <button className="voice-activate" onClick={onStart} disabled={voiceReady || phase === 'boot'}>{voiceReady ? 'DIGA “JARVIS”' : phase === 'boot' ? 'INICIALIZANDO…' : 'ATIVAR CONVERSA POR VOZ'}<span>↗</span></button>
      <p className="instrument-note">{voiceReady ? (hasDesktopWindow() ? 'Espaço para falar · Esc para fechar' : 'Espaço para falar · Escape para aguardar') : 'O acesso ao microfone depende da sua permissão.'}</p>
      <label className="voice-choice">VOZ <select aria-label="Voz do Jarvis" value="openspeaker" disabled><option value="openspeaker">{caps().tts ? "Jarvis · gravações prontas" : "Gravações · conferir instalação"}</option></select></label>
      <SpeakerControls onTest={onTestVoice} disabled={busy}/>
    </aside>

    <aside className="systems-cluster">
      <div className="instrument-heading"><span>03</span> SISTEMAS DISPONÍVEIS</div>
      {modules.map(m => <div className="system-row" key={m.title}><i className={m.ready ? 'live' : ''}/><div><b>{m.title}</b><span>{m.detail}</span></div><em>{m.ready ? 'ON' : '…'}</em></div>)}
      <button className="module-trigger" onClick={() => setTray('modules')}>EXPLORAR COMANDOS <span>↗</span></button>
      <div className="instrument-separator"/>
      <div className="instrument-heading"><span>04</span> ATIVIDADE</div>
      <div className="activity-feed">{actions.length ? actions.map((a, i) => <div key={`${a.time}-${i}`}><time>{a.time}</time><span>{name(a.name)}</span></div>) : <p>As ações executadas aparecem aqui durante a tarefa.</p>}</div>
    </aside>

</div>}
      {tray === 'settings' && <button className="boot-replay" onClick={() => { setTray(null); window.dispatchEvent(new Event('jarvis-preview-boot')) }}>REVER INICIALIZAÇÃO ↗</button>}
      {tray === 'settings' && <label className="settings-effort">RACIOCÍNIO <select aria-label="Nível de raciocínio nas configurações" value={effort} onChange={e => { setEffort(e.target.value); localStorage.setItem('jarvis.effort', e.target.value) }}><option value="low">Rápido</option><option value="medium">Equilibrado</option><option value="high">Profundo</option></select></label>}
      {tray === 'modules' && <div className="module-grid">{MODULES.map(m => <button key={m.key} onClick={() => module(m.prompt)}><i>{m.glyph}</i><b>{m.name}</b><span>{m.sub}</span></button>)}</div>}
      {tray === 'history' && <div className="session-list"><button className="new-session" onClick={() => openConversation()}>+ NOVA CONVERSA</button>{chats().map(c => <button key={c.id} className={c.id === currentId() ? 'selected' : ''} onClick={() => openConversation(c.id)}><b>{c.title}</b><span>{c.turns.length} mensagens · {new Date(c.updated).toLocaleDateString('pt-BR')}</span></button>)}{chats().length === 0 && <p>Suas conversas serão salvas automaticamente aqui.</p>}</div>}
      {tray === 'outputs' && <div className="output-list">{outputs.length ? outputs.map(o => <a key={o.name} href={`${BRIDGE_HTTP_URL}/download?name=${encodeURIComponent(o.name)}`} download><span>▤</span><b>{o.name}</b><small>{Math.max(1, Math.round(o.size / 1024))} KB</small><em>↓</em></a>) : <p>Peça um relatório, planilha, documento ou arquivo. As entregas criadas aparecem aqui para baixar.</p>}</div>}
    </div>}
    <div className="console-bottomline"><span>JARVIS / PERSONAL OPERATING SYSTEM</span><span>{clock.toLocaleDateString('pt-BR', { timeZone: profile.timezone, day: '2-digit', month: 'short', year: 'numeric' })}</span></div>
  </div>, document.body)
}

