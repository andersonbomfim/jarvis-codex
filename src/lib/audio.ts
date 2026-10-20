/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Float32Array<ArrayBuffer> | null = null
let opening: Promise<MediaStream> | null = null
let smooth = 0

// Verified on this computer: USB Audio and WEB CAMER share the same physical
// device container. Browser IDs differ between Chrome and the desktop app.
const webcamLabel = /\bUSB Audio\b/i

export function selectMicrophone(deviceId: string, label: string) {
  localStorage.setItem('jarvis.microphone', deviceId)
  localStorage.setItem('jarvis.microphone.label', label)
  localStorage.setItem('jarvis.microphone.mode', deviceId === 'webcam' ? 'auto' : 'manual')
}

async function captureMicrophone(expired: () => boolean): Promise<MediaStream> {
  const manual = localStorage.getItem('jarvis.microphone.mode') === 'manual'
  const savedId = localStorage.getItem('jarvis.microphone')
  const savedLabel = localStorage.getItem('jarvis.microphone.label')
  const acquire = async (deviceId?: string) => {
    const captured = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } })
    if (expired()) {
      captured.getTracks().forEach(track => track.stop())
      throw new Error('A abertura anterior do microfone expirou. Clique em ativar voz para tentar novamente.')
    }
    return captured
  }
  // Every installation starts with its own system default, never the creator's webcam.
  if (!manual || !savedId || savedId === 'default') return acquire()
  let devices = await navigator.mediaDevices.enumerateDevices?.() ?? []
  let permissionStream: MediaStream | null = null
  try {
    // Labels are hidden until permission has been granted. This initial stream
    // is only for permission; the recognizer never consumes the default mic.
    if (!devices.some(d => d.kind === 'audioinput' && d.label)) {
      permissionStream = await acquire()
      devices = await navigator.mediaDevices.enumerateDevices?.() ?? []
    }
    const inputs = devices.filter(d => d.kind === 'audioinput' && !['default', 'communications'].includes(d.deviceId))
    const preferred = manual
      ? inputs.find(d => d.deviceId === savedId) ?? inputs.find(d => d.label === savedLabel)
      : inputs.find(d => webcamLabel.test(d.label))
    if (!preferred) {
      throw new Error(manual
        ? 'O microfone escolhido não está disponível. Confira a conexão ou selecione outra entrada nas configurações.'
        : 'Não encontrei o microfone da webcam (USB Audio). Confira a conexão USB da webcam e ative a voz novamente.')
    }
    localStorage.setItem('jarvis.microphone', preferred.deviceId)
    localStorage.setItem('jarvis.microphone.label', preferred.label)
    if (permissionStream?.getAudioTracks()[0]?.getSettings().deviceId === preferred.deviceId) {
      const captured = permissionStream
      permissionStream = null
      return captured
    }
    // Release the temporary default before opening the selected physical mic.
    permissionStream?.getTracks().forEach(track => track.stop())
    permissionStream = null
    return await acquire(preferred.deviceId)
  } finally {
    permissionStream?.getTracks().forEach(track => track.stop())
  }
}

export async function getMic(): Promise<MediaStream> {
  if (stream?.getAudioTracks().some(t => t.readyState === 'live')) return stream
  if (opening) return opening
  let expired = false
  let deadline: ReturnType<typeof setTimeout> | undefined
  const capture = captureMicrophone(() => expired).then(s => {
    if (expired) {
      s.getTracks().forEach(track => track.stop())
      throw new Error('A abertura anterior do microfone expirou. Clique em ativar voz para tentar novamente.')
    }
    return s
  })
  const timeout = new Promise<MediaStream>((_, reject) => {
    deadline = setTimeout(() => {
      expired = true
      reject(new Error('O navegador não liberou o microfone. Você pode continuar por texto e ativar a voz depois.'))
    }, 8000)
  })
  opening = Promise.race([capture, timeout]).then(s => { stream = s; return s }).finally(() => {
    if (deadline) clearTimeout(deadline)
    opening = null
  })
  return opening
}

export async function startAnalyser(): Promise<void> {
  if (analyser && stream?.getAudioTracks().some(t => t.readyState === 'live') && ctx?.state !== 'closed') { if (ctx?.state === 'suspended') await Promise.race([ctx.resume(), new Promise(resolve => setTimeout(resolve, 1000))]); return }
  if (ctx && ctx.state !== 'closed') void ctx.close()
  analyser = null
  const s = await getMic()
  ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Float32Array(analyser.fftSize)
  // Permission alone does not start a suspended AudioContext.
  if (ctx.state === 'suspended') await Promise.race([ctx.resume(), new Promise(resolve => setTimeout(resolve, 1000))])
}

export function microphoneStatus() {
  const track = stream?.getAudioTracks()[0]
  return { label: track?.label ?? '', live: track?.readyState === 'live', enabled: track?.enabled ?? false, muted: track?.muted ?? false,
    context: ctx?.state ?? 'closed', deviceId: track?.getSettings().deviceId ?? '' }
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf || ctx?.state !== 'running') return 0
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (const sample of buf) sum += sample * sample
  const level = Math.min(1, Math.max(0, Math.sqrt(sum / buf.length) - .002) * 12)
  smooth += (level - smooth) * (level > smooth ? .6 : .18)
  return smooth
}

/** Analyser fed from an <audio> element, so the orb reacts while JARVIS talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  void c.resume()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}
