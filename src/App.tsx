import { useEffect, useRef } from 'react'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Boot } from './ui/Boot'
import { Console } from './ui/Console'
import { audioEnabled, TEXT_ONLY } from './lib/sessions'
import { Diagnostics } from './ui/Diagnostics'
import { useStore } from './store'
import { startVoice, recognitionStatus, type Voice, type VoiceMode } from './lib/voice'
import { createSpeaker, cycleVoice, currentVoiceName, audioPlaying, diag as speechDiagnostics } from './lib/tts'
import { startMorningBriefing } from './lib/morning'
import { connectionError } from './lib/reconnect'
import { fixedReplyFor, acknowledgementFor, broadPoliticsScope, preloadVoicePresets, phrase, isFixedPhrase } from './lib/assistant-cache'
import * as sfx from './lib/sfx'
import * as music from './lib/music'
import * as hands from './lib/hands'
import { listenForClap } from './lib/clap'
import * as camera from './lib/camera'
import * as kokoro from './lib/kokoro'
import { TTS_ENGINE, BRIDGE_HTTP_URL } from './config'
import { forTool, attention } from './lib/fillers'
import {
  ask,
  warm,
  interrupt,
  watchServers,
  watchPanels,
  watchBlades,
  watchCapture,
  watchUi,
  watchConnection,
  isConnected,
  reportVoiceStatus,
  connectedLabels,
  usingBridge,
  type Msg,
  type AskHandlers,
} from './lib/brain'
import { startAnalyser, micLevel, microphoneStatus } from './lib/audio'
import { hasDesktopWindow } from './lib/desktop'
import { completionPhrase, isMorningBriefingRequest } from '../shared/reply-policy.mjs'
import { probeCapabilities } from './lib/capabilities'
import { env } from './config'

/**
 * The conversation.
 *
 * This used to be a sequential loop — greet, await a capture, await an answer,
 * repeat — with the microphone opened and closed around each step. That shape
 * cannot be interrupted: while it is awaiting the answer, nothing is listening,
 * so there is no way for the user to get a word in.
 *
 * It is an event machine now. The voice loop runs continuously and pushes
 * events at us; every one of them is legal in every phase. Saying anything at
 * all stops him talking, and whatever you say next becomes the new turn.
 */

/** How long to wait for someone to start speaking after he wakes. Generous:
 *  people say his name and *then* think about what they wanted. */
const AWAIT_SPEECH_MS = 14000

/** After an answer, how long the mic stays open for a follow-up before he
 *  drops back to standby. Long enough that you don't have to say the name
 *  again to continue a thought. */
const FOLLOW_UP_MS = 11000

/** crypto.randomUUID needs a secure context, which a LAN address over plain
 *  http is not. Not worth failing a whole turn over an id. */
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** The same mishearings voice.ts accepts for the wake word — otherwise a turn
 *  that woke him as "travis" gets that word sent on to the model as a question. */
const NAME = '(?:jarvis|jarvys|jervis|járvis|jarves|travis|jarviss|java\'s|jarv)'
/** A bare vocative — "Jarvis", "hey jarvis" — with nothing asked. */
const BARE_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo|ei|oi|olá|ola)?\\s*${NAME}[\\s,.!?]*$`, 'i')
/** A leading vocative on a real command: "Jarvis, what's the weather". */
const LEADING_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo|ei|oi|olá|ola)?\\s*${NAME}\\b[\\s,.:!?-]*`, 'i')

/**
 * Telling him to go away.
 *
 * "Jarvis, logout" drops him back to standby, where nothing but his name is
 * acted on again. The name is optional — by the time you are dismissing him you
 * are already talking to him — but the phrase has to be the whole utterance.
 * That last part matters: "put the computer to sleep" and "log out of my
 * account" are jobs for him, not instructions to stop listening, and an
 * unanchored match would swallow both. Only a bare dismissal counts.
 */
const LOGOUT = new RegExp(
  `^(?:hey|hi|ok|okay|yo|ei|oi|olá|ola)?\\s*(?:${NAME}[\\s,.:!?-]*)?` +
    `(?:descansar|pode descansar|até mais|ate mais|silêncio|silencio|log ?out|log off|sign ?out|sign off|stand ?down|go to sleep|` +
    `goodnight|good night|goodbye|good bye|bye|dismissed|` +
    `that (?:will|'?ll) be all|that'?s all)` +
    `(?:\\s+(?:please|now|sir|thanks|thank you|${NAME}))*[\\s,.!?]*$`,
  'i',
)

/**
 * Started by the launcher, into a window nobody can see.
 *
 * The ignition button assumes someone is looking at it, and the clap listener
 * assumes someone is in the room with a screen. Run as a background assistant
 * there is neither, so `?auto=1` powers him up on load instead. Chrome is
 * started with its autoplay policy relaxed for exactly this case — without that
 * the audio context comes up suspended and he boots deaf and mute.
 */
const AUTO =
  typeof window !== 'undefined' &&
  !new URLSearchParams(window.location.search).has('manual') &&
  localStorage.getItem('jarvis.autoVoice') !== 'off'

export default function App() {
  const store = useStore
  const phase = useStore((s) => s.phase)
  const history = useRef<Msg[]>([])
  const speaker = useRef<ReturnType<typeof createSpeaker> | null>(null)
  const voice = useRef<Voice | null>(null)

  /**
   * Monotonic turn counter. Every await in a turn checks it on the way out:
   * if it has moved, that turn was superseded by a barge-in and must not touch
   * the phase, the speaker, or the busy state on its way to the floor.
   */
  const turn = useRef(0)
  const booting = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const voicePoll = useRef<ReturnType<typeof setInterval> | null>(null)
  const previewingVoice = useRef(false)

  // -- helpers --------------------------------------------------------------

  const clearIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }

  const silence = () => {
    speaker.current?.cancel()
    speaker.current = null
  }

  const goDormant = () => {
    clearIdle()
    silence()
    turn.current++
    const s = store.getState()
    s.setCaption('')
    s.setActiveTool(null)
    music.working(false)
    music.duck(false)
    sfx.duck(false)
    s.setPhase('dormant')
  }

  /**
   * Dismissed. Acknowledge, then go quiet.
   *
   * The acknowledgement is the point: silence in answer to "logout" is
   * indistinguishable from not having heard it, and the next thing anyone does
   * about that is say it again, louder. Standing down happens after the line
   * finishes rather than before, because goDormant cancels whatever is
   * speaking — including this. The timeout is the guard against a speech engine
   * that never reports the end of a sentence; missing the acknowledgement is a
   * blemish, staying awake after being told to go is the actual failure.
   */
  const standDown = () => {
    clearIdle()
    silence()
    turn.current++
    const s = store.getState()
    s.setCaption('')
    s.setPhase('speaking')

    const bye = createSpeaker()
    speaker.current = bye
    bye.say('Como desejar, senhor.')
    const done = () => {
      if (speaker.current === bye) speaker.current = null
      goDormant()
    }
    void Promise.race([
      bye.end(),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(done, done)
  }

  /** Open the mic and wait. `window` is how long before he gives up. */
  const listen = (window: number) => {
    clearIdle()
    const s = store.getState()
    s.setCaption('')
    s.setPhase('listening')
    sfx.play('listen')
    idleTimer.current = setTimeout(goDormant, window)
  }

  // -- one turn -------------------------------------------------------------

  const respond = async (said: string): Promise<void> => {
    const mine = ++turn.current
    const stale = () => mine !== turn.current

    clearIdle()
    const s = store.getState()
    // Last turn's panels and blades go now, before the new answer starts
    // putting its own up. Anything the model marked sticky survives.
    s.clearPanels()
    s.clearBlades()
    s.setCaption('')
    s.pushTurn({ id: newId(), role: 'user', text: said })
    s.setPhase('thinking')

    const spk = createSpeaker()
    speaker.current = spk
    sfx.duck(true)
    music.duck(true)

    const turnId = newId()
    let started = false
    let filled = false
    const fixed = fixedReplyFor(said)
    const morningRequest = isMorningBriefingRequest(said)
    let preparedBriefingAudio: string | null = null
    const politics = broadPoliticsScope(said)
    const acknowledgement = fixed || morningRequest ? null : acknowledgementFor(said) || (politics ? phrase('research') : phrase('one-moment'))
    if (acknowledgement) {
      filled = true
      if (audioEnabled()) spk.say(acknowledgement)
    }

    const getAnswer = async (handlers: AskHandlers) => {
      if (fixed) { handlers.onText?.(fixed.text); return { text: fixed.text, tools: [] } }
      if (morningRequest) {
        const response = await fetch(BRIDGE_HTTP_URL + '/morning-briefing', {signal:AbortSignal.timeout(5000)})
        if (!response.ok) throw new Error('Não consegui consultar o briefing de hoje.')
        const briefing = await response.json() as {text:string;status:string;audioUrl:string|null}
        const text = briefing.text?.trim() || 'O briefing de hoje ainda não está preparado.'
        if (briefing.status === 'ready' && briefing.audioUrl?.startsWith('/morning-briefing/audio?')) preparedBriefingAudio = BRIDGE_HTTP_URL + briefing.audioUrl
        handlers.onText?.(text)
        return {text,tools:[]}
      }
      if (politics) {
        try {
          const response = await fetch(BRIDGE_HTTP_URL + '/news/politics?scope=' + politics, { signal: AbortSignal.timeout(3000) })
          if (response.ok) {
            const news = await response.json() as { fresh: boolean; narration?: string; updatedAt: string; articles: Array<{ title: string; url: string; source: string; summary: string; region: string }> }
            if (!stale() && news.fresh && news.narration) {
              const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
              const when = new Date(news.updatedAt).toLocaleTimeString('pt-BR', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour: '2-digit', minute: '2-digit' })
              const articles = news.articles.filter(item => politics === 'geral' || item.region === politics)
              store.getState().pushBlade({ id: 'politics-' + newId(), title: 'Notícias políticas · ' + when, kind: 'markup', size: 'tall', hold: 'turn', html: '<p class="hud-note">Atualizado às ' + when + '.</p>' + articles.map(item => '<p class="hud-note"><strong>' + escape(item.title) + '</strong><br>' + escape(item.summary) + '</p>').join('') })
              handlers.onText?.(news.narration)
              return { text: news.narration, tools: [] }
            }
          }
        } catch { /* Specific requests and missing/stale snapshots use the real research path. */ }
      }
      return ask(said, history.current, handlers)
    }

    try {
      const { text } = await getAnswer({
        onText: (delta) => {
          if (stale()) return
          if (!started) {
            started = true
            store.getState().setPhase('speaking')
            // The answer arriving is what ends the tool phase — a timer would
            // clear the readout while a slow tool was still running.
            store.getState().setActiveTool(null)
            music.working(false)
            store.getState().pushTurn({ id: turnId, role: 'jarvis', text: '' })
          }
          store.getState().appendToLastTurn(delta)
          if (audioEnabled() && fixed) spk.say(fixed.text)
        },
        onTool: (name) => {
          if (stale()) return
          // Only claim the tooling phase while he has nothing to say yet.
          // Setting it unconditionally pinned the machine in 'tooling' for the
          // rest of any answer that called a tool after it started talking,
          // which also broke the reactor's lip-sync for the remainder.
          if (!started) store.getState().setPhase('tooling')
          store.getState().setActiveTool(name)
          sfx.play('tool')
          music.working(true)
          // Say something the moment work starts — a tool can take ten seconds
          // and silence that long reads as a crash. Once per turn only; a
          // chain of five tools shouldn't produce five apologies.
          if (!filled && !started) {
            filled = true
            if (audioEnabled()) spk.say(forTool(name))
          }
        },
      })

      if (stale()) return

      // The bridge keeps conversation state in its own session, so history is
      // only threaded through on the direct path.
      if (!usingBridge) {
        history.current.push({ role: 'user', content: said })
        history.current.push({ role: 'assistant', content: text || '…' })
        if (history.current.length > 16) {
          history.current = history.current.slice(-16)
        }
      }

      if (preparedBriefingAudio && audioEnabled()) spk.clip(preparedBriefingAudio, text)
      else if (!fixed && text.trim() && audioEnabled()) spk.say(completionPhrase(text))
      await spk.end()
      if (stale()) return
      sfx.play('done')
    } catch (err) {
      if (stale()) return
      console.error(err)
      sfx.play('error')
      store
        .getState()
        .setError(err instanceof Error ? err.message : 'Something went wrong.')
      if (audioEnabled()) { spk.say(phrase('failed')); await spk.end() }
    } finally {
      if (!stale()) {
        speaker.current = null
        sfx.duck(false)
        music.duck(false)
        store.getState().setActiveTool(null)
        music.working(false)
        // Stay open. Having to say his name again to add one more sentence is
        // the difference between a conversation and a vending machine.
        if (voice.current) listen(FOLLOW_UP_MS)
        else store.getState().setPhase('dormant')
      }
    }
  }

  // -- voice events ---------------------------------------------------------

  /** What the voice loop should do with what it hears, derived from phase. */
  const mode = (): VoiceMode => {
    if (previewingVoice.current) return 'deaf'
    switch (store.getState().phase) {
      case 'offline':
      case 'boot':
        return 'deaf'
      case 'dormant':
        return 'wake'
      case 'waking':
      case 'listening':
        return 'command'
      default:
        return 'guard' // thinking, tooling, speaking
    }
  }

  const onWake = (trailing: string) => {
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot') return

    // "Jarvis, logout" said to someone who is already asleep. Stay asleep, and
    // say nothing about it — waking up to announce that he is standing down is
    // exactly the noise the command exists to avoid.
    if (trailing && LOGOUT.test(trailing)) {
      goDormant()
      return
    }

    store.getState().setError(null)
    sfx.play('wake')

    // "Jarvis, what's happening in AI this week" in one breath. Waiting for a
    // greeting he didn't need is the most common way an assistant wastes time.
    if (trailing) {
      void respond(trailing)
      return
    }

    store.getState().setPhase('waking')

    // Answer to his name. Deliberately NOT awaited any more: the microphone is
    // already open and the echo filter knows his voice, so the user can talk
    // straight over the greeting instead of waiting it out.
    const greeting = createSpeaker()
    speaker.current = greeting
    greeting.say(attention())
    void greeting.end()

    listen(AWAIT_SPEECH_MS)
  }

  /**
   * Someone started talking. This is the whole point of the rewrite: he stops,
   * immediately, whatever he was doing.
   */
  const onSpeechStart = () => {
    // A voice test must finish even if its playback leaks into the microphone.
    if (previewingVoice.current) return
    clearIdle()
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    const wasBusy =
      phase === 'thinking' || phase === 'tooling' || phase === 'speaking'

    if (wasBusy) {
      // Energy alone can be speaker echo or room noise. Preserve both work
      // and its recorded response until a new command is confirmed.
      return
    }
    silence()
    store.getState().setPhase('listening')
  }

  const onUtterance = (text: string) => {
    if (previewingVoice.current) return
    const phase = store.getState().phase
    if (phase === 'offline' || phase === 'boot' || phase === 'dormant') return

    // Dismissed mid-conversation. Checked before the vocative strip, so
    // "Jarvis, logout" is read as an instruction to him rather than as a
    // question about logging out of something.
    if (LOGOUT.test(text)) {
      standDown()
      return
    }

    // People keep using his name as a vocative once they're already talking to
    // him. Strip it rather than sending "jarvis" to the model as a question.
    if (BARE_NAME.test(text)) {
      listen(AWAIT_SPEECH_MS)
      return
    }
    const said = text.replace(LEADING_NAME, '').trim()
    if (!said) {
      listen(AWAIT_SPEECH_MS)
      return
    }

    silence()
    void respond(said)
  }

  const onPartial = (text: string) => {
    store.getState().setCaption(text)
  }

  const onVoiceError = (message: string) => {
    store.getState().setError(message)
    if (!voice.current?.live()) {
      useStore.setState({ voiceReady: false })
      booting.current = false
    }
  }

  const previewVoice = async (text = 'Para o senhor, sempre.') => {
    if (previewingVoice.current) return
    previewingVoice.current = true
    silence()
    localStorage.setItem('jarvis.audio', 'on')
    window.dispatchEvent(new Event('jarvis-audio-change'))
    store.getState().setError(null)
    const previousStarts = (window as unknown as { __tts?: { started: number } }).__tts?.started || 0
    try {
      await probeCapabilities()
      const test = createSpeaker()
      speaker.current = test
      if (isFixedPhrase(text)) test.say(text)
      else {
        const response = await fetch(BRIDGE_HTTP_URL + '/morning-briefing', { signal: AbortSignal.timeout(5000) })
        const briefing = response.ok ? await response.json() as { text: string; audioUrl: string | null } : null
        if (!briefing?.audioUrl || briefing.text.trim() !== text.trim()) {
          store.getState().setError('Essa resposta está disponível apenas em texto. Nenhum áudio foi gerado.')
          return
        }
        test.clip(BRIDGE_HTTP_URL + briefing.audioUrl, text)
      }
      await test.end()
      const d = (window as unknown as { __tts?: { started: number; lastError: string } }).__tts
      if (!d || d.started === previousStarts) store.getState().setError(`A voz não iniciou: ${d?.lastError || 'verifique a saída de som selecionada'}.`)
    } finally {
      // Let the recognizer finish draining the echo of this fixed test sentence.
      setTimeout(() => { previewingVoice.current = false }, 2000)
    }
  }

  // Register visual tools for typed commands as well as voice.
  const prepareInterface = () => {
    watchServers((servers) => store.getState().setConnected(servers))
    watchPanels((panel) => store.getState().pushPanel(panel))
    watchBlades((blade) => store.getState().pushBlade(blade))

    /**
     * JARVIS asking to see something.
     *
     * Announced on screen for as long as it takes, with whatever he said he was
     * looking for. The camera's own light is on too, but a hardware light that
     * appears with no explanation is exactly the thing that makes people
     * distrust an assistant — so the interface says it before they have to ask.
     */
    watchCapture(async (req) => {
      const note =
        req.mode === 'watch'
          ? req.when === 'past'
            ? req.reason || 'reviewing the last few seconds'
            : `${req.reason || 'watching'} · ${req.seconds}s`
          : req.reason || 'taking a look'
      store.getState().setLooking(note)

      // The past is only available if something has been remembering it, and
      // that only happens while the camera is on screen. Answering plainly
      // beats opening the camera and recording the next few seconds instead,
      // which is a different question from the one that was asked.
      if (req.mode === 'watch' && req.when === 'past' && camera.bufferedSeconds() < 1) {
        store.getState().setLooking(null)
        return {
          error:
            'There is no recent footage — the camera has to be open on screen ' +
            'for me to remember what just happened. Ask me to open the camera, ' +
            'and I can watch from then on.',
        }
      }

      // Held for the whole capture. Without this the stream can be torn down by
      // whoever else was using it half way through a six-second watch.
      let held = false
      try {
        await camera.holdCamera()
        held = true
        if (req.mode === 'look') return camera.grabFrame()
        if (req.when === 'past') {
          const grid = camera.recentGrid(req.seconds, 9)
          return grid ?? { error: 'There is not enough recent footage to review.' }
        }
        return await camera.watchAhead(req.seconds, 9)
      } catch (err) {
        return {
          error:
            (err as DOMException)?.name === 'NotAllowedError'
              ? 'The camera is not permitted, so I cannot see anything.'
              : `The camera could not be read: ${(err as Error)?.message ?? err}`,
        }
      } finally {
        if (held) camera.releaseCamera()
        store.getState().setLooking(null)
      }
    })

    // The interface is JARVIS's to drive. These arrive out of band, pushed
    // mid-turn the way panels are, so a command can retint the reactor or put
    // something into orbit while he is still speaking the sentence about it.
    watchUi((op, args) => {
      const s = store.getState()
      const a = (args ?? {}) as Record<string, never>
      switch (op) {
        case 'patch':
          s.applyUi(args)
          break
        case 'orbit':
          if (a.action === 'add') s.addOrbit(args)
          else if (a.action === 'remove') s.removeOrbit(String(a.id))
          else s.clearOrbits()
          break
        case 'effect':
          s.fireEffect(a.kind)
          break
        case 'reset':
          s.resetUi()
          break
        case 'screen':
          s.clearScreen(a.what ?? 'all')
          break
        default:
          console.warn('[jarvis] unknown ui op:', op, args)
      }
    })
    // The recent transcript is sent again on the first real request after a
    // reconnect. A recovered connection does not establish lost conversation.
    watchConnection((state) => {
      const s = store.getState()
      s.setError(connectionError(state, s.error))
    })
    if (isConnected()) {
      const s = store.getState()
      s.setError(connectionError('open', s.error))
    }
  }

  useEffect(() => {
    prepareInterface()
    void warm().catch((err: Error) => store.getState().setError(err.message))
    void probeCapabilities()
    // The callbacks use the current store and camera module, not render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- power on -------------------------------------------------------------

  const powerOn = async () => {
    // The ignition button and the space bar can both land here, and the phase
    // only moves after the first await — so without this a double press boots
    // twice, arming two voice loops and two download polls.
    if (booting.current) return
    if (voice.current?.live() && microphoneStatus().live) return
    voice.current?.stop()
    voice.current = null
    useStore.setState({ voiceReady: false })
    store.getState().setError(null)
    booting.current = true

    try {
      await ignite()
    } catch (err) {
      // The guard must not outlive a failed boot. Audio unlock can be refused,
      // the microphone prompt dismissed, the bridge unreachable at the wrong
      // moment — and with the flag still latched the ignition button was dead
      // for the rest of the page, recoverable only by reloading. Reset it and
      // put the button back so the user can simply press it again.
      booting.current = false
      console.error('[jarvis] power-up failed:', err)
      store.getState().setPhase('offline')
      store
        .getState()
        .setError(
          err instanceof Error
            ? err.message
            : 'Não foi possível iniciar a voz. Clique para tentar novamente.',
        )
    } finally {
      booting.current = false
    }
  }

  const ignite = async () => {
    const s = store.getState()

    // Must happen inside the click handler — browsers won't start an
    // AudioContext or speech synthesis without a user gesture.
    await Promise.race([sfx.unlockAudio(), new Promise(resolve => setTimeout(resolve, 300))])
    sfx.play('boot')
    // The score. Must be started from inside this click handler for the same
    // reason as the rest of the audio.
    // Keep the microphone clear: startup has no background music.

    s.setPhase('boot')

    const warming = warm().catch((err: Error) => s.setError(err.message))

    if (!usingBridge && !env.anthropicKey) {
      s.setError(
        'No Anthropic API key — copy .env.example to .env.local and set VITE_ANTHROPIC_API_KEY.',
      )
    }

    // Pull the neural voice down during the boot sequence so the first
    // "Hey Jarvis" isn't waiting on an 86MB download. Deliberately not awaited
    // — if it's slow, JARVIS comes up on the system voice and swaps over the
    // moment the model is ready.
    if (TTS_ENGINE === 'kokoro') {
      void kokoro.load()
      voicePoll.current = setInterval(() => {
        const p = kokoro.loadProgress()
        if (kokoro.isReady() || kokoro.isUnavailable()) {
          store.getState().setBootNote('')
          if (voicePoll.current) clearInterval(voicePoll.current)
          voicePoll.current = null
        } else if (p > 0 && p < 1) {
          store.getState().setBootNote(`voice ${Math.round(p * 100)}%`)
        }
      }, 200)
    }

    // Allow the holographic assembly to resolve before starting voice capture.
    await new Promise((r) => setTimeout(r, 2400))
    await warming
    store.getState().setConnected(connectedLabels())
    store.getState().setVoice(currentVoiceName())

    // Desktop installation can be used before Monday's microphone/voice setup.
    if (TEXT_ONLY) { store.getState().setPhase('dormant'); return }

    // The analyser is what makes the reactor pulse with your voice. It needs a
    // getUserMedia stream; speech recognition does not, and gets its own. So a
    // failure here costs the animation and nothing else — saying "voice input
    // is unavailable" was both alarming and untrue.
    try {
      await startAnalyser()
    } catch {
      console.warn(
        '[jarvis] no microphone stream — the reactor will not pulse with your ' +
          'voice. Speech recognition is unaffected.',
      )
    }

    // Ask the bridge which speech engines exist before the loop starts, so the
    // first turn already uses ElevenLabs when a key is present and the browser
    // fallback when it is not — no flag, no reload.
    await probeCapabilities()
    void preloadVoicePresets(BRIDGE_HTTP_URL)

    // One voice loop, started once, running until the page closes.
    voice.current = await startVoice({
      mode,
      onWake,
      onSpeechStart,
      onPartial,
      onUtterance,
      onError: onVoiceError,
      onState: ready => useStore.setState({ voiceReady: ready }),
    })

    store.getState().setPhase('dormant')
    if (new URLSearchParams(location.search).has('soundcheck')) void previewVoice()
  }

  // -- unattended start -----------------------------------------------------

  useEffect(() => {
    const check = () => {
      const s = store.getState(), mic = microphoneStatus()
      const alive = voice.current?.live() ?? false
      reportVoiceStatus({ ...mic, ...recognitionStatus(), phase: s.phase, ready: s.voiceReady, recognizerLive: alive, level: micLevel(), desktop: hasDesktopWindow(), audioEnabled: audioEnabled(), playbackStarted: speechDiagnostics.started, playbackFailures: speechDiagnostics.failures, playbackError: speechDiagnostics.lastError })
      if (!s.voiceReady || (mic.live && alive)) return
      // A stale flag must never disable the recovery button. Try once while
      // idle; a denied permission leaves a visible error and a clickable retry.
      useStore.setState({voiceReady:false})
      voice.current?.stop()
      voice.current = null
      if (['dormant','offline','listening'].includes(s.phase) && !booting.current) void powerOn()
      else s.setError('A captura do microfone parou. Ative a conversa por voz novamente.')
    }
    check()
    const timer = setInterval(check, 2000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** No button, no clap, no one watching: come up on our own. */
  useEffect(() => {
    if (!AUTO) return
    void powerOn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -- clap to start --------------------------------------------------------

  /**
   * A clap brings him up, as an alternative to the button.
   *
   * Only while the ignition screen is showing, and torn down the moment he
   * boots — the microphone is about to belong to the voice loop, and two
   * analysers arguing over the same stream is how you get an assistant that
   * hears half of what you say.
   *
   * Deliberately silent about failure. If the microphone is refused, or has not
   * been granted yet, the button is still right there; announcing an error
   * about a feature nobody asked for would be worse than quietly doing without.
   */
  useEffect(() => {
    // In unattended mode the microphone belongs to the voice loop from the
    // first second; a clap detector fighting it for the stream is how you get
    // an assistant that hears half of what you say.
    if (AUTO || phase !== 'offline') return
    let live: { stop: () => void } | null = null
    let gone = false
    void listenForClap(() => {
      if (!gone) void powerOn()
    }).then((l) => {
      if (gone) l.stop()
      else live = l
    })
    return () => {
      gone = true
      live?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // -- level pump + keys ----------------------------------------------------

  useEffect(() => {
    let raf = 0

    const pump = () => {
      // While speaking, follow JARVIS's own output rather than the mic, so the
      // orb lip-syncs instead of reacting to room noise.
      const input = micLevel(), talking = audioPlaying()
      const output = talking && speaker.current ? speaker.current.level() : 0
      store.setState({ micLevel: input, outputLevel: output, assistantSpeaking: talking, level: talking ? output : input })
      raf = requestAnimationFrame(pump)
    }
    pump()

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // V auditions the next British voice installed on this machine. Which
      // ones exist varies per Mac, so hearing them beats trusting a ranking.
      // Bare V only — ⌘V and ⌃V are paste, and swallowing those was rude.
      if (
        e.key === 'v' &&
        !e.repeat &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault()
        const name = cycleVoice()
        store.getState().setVoice(name)
        silence()
        const demo = createSpeaker()
        speaker.current = demo
        demo.say(`Voz selecionada: ${name.replace(/\(.*?\)/g, '').trim()}.`)
        void demo.end()
        return
      }

      // G puts the camera on and starts tracking hands. Off by default and
      // never implicit: a webcam that turns itself on because an interface
      // thought it might be useful is not a trade anyone agreed to.
      if (e.key === 'g' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        const on = store.getState().gestures
        if (on) {
          hands.disableHands()
          store.getState().setGestures(false)
        } else {
          store.getState().setError(null)
          void hands
            .enableHands()
            .then(() => store.getState().setGestures(true))
            .catch((err: Error) => {
              store.getState().setGestures(false)
              store
                .getState()
                .setError(
                  err?.name === 'NotAllowedError'
                    ? 'Camera access denied — gesture control is unavailable.'
                    : `Gesture control failed to start: ${err?.message ?? err}`,
                )
            })
        }
        return
      }

      // T speaks a fixed line, bypassing the wake word, the recogniser and the
      // model entirely. When "I can't hear him" is the report, this is the one
      // keypress that separates a broken voice engine from a broken voice loop
      // — and it prints the verdict rather than making you infer it.
      if (e.key === 't' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        silence()
        const t = createSpeaker()
        speaker.current = t
        t.say('Teste de áudio. Se você está ouvindo, a voz está funcionando.')
        void t.end().then(() => {
          const d = (window as unknown as Record<string, Record<string, unknown>>).__tts
          console.info('[jarvis] audio test →', d)
          if (d && d.started === 0 && d.rescued === 0) {
            store.getState().setError(
              `No sound produced. engine=${d.engine} voice=${d.voice} error=${d.lastError || 'none'}`,
            )
          }
        })
        return
      }

      // The native app intercepts Escape to close its window. In a browser,
      // Escape still pauses the voice session.
      if (e.key === 'Escape') {
        e.preventDefault()
        if (store.getState().phase !== 'offline') goDormant()
        return
      }

      // Space starts a turn without the wake word. Worth using while filming so
      // a missed wake word doesn't cost a take.
      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()

      const phase = store.getState().phase
      if (phase === 'offline') {
        void powerOn()
      } else if (phase === 'boot') {
        /* ignore — the boot sequence owns the phase until it finishes */
      } else if (
        phase === 'thinking' ||
        phase === 'tooling' ||
        phase === 'speaking'
      ) {
        onSpeechStart()
        listen(AWAIT_SPEECH_MS)
      } else {
        onWake('')
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      clearIdle()
      if (voicePoll.current) clearInterval(voicePoll.current)
      voice.current?.stop()
      speaker.current?.cancel()
      // The camera must not outlive the page that turned it on.
      hands.disableHands()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => startMorningBriefing(BRIDGE_HTTP_URL,
    () => ['dormant', 'offline'].includes(store.getState().phase) && !audioPlaying(),
    async (briefing, signal) => {
      const s = store.getState()
      s.pushTurn({ id: 'morning-' + briefing.date, role: 'jarvis', text: briefing.text })
      const escaped = briefing.text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
      s.pushBlade({ id: 'morning-' + briefing.date, title: 'Bom dia · ' + briefing.date, kind: 'markup', size: 'tall', hold: 'sticky', html: escaped.split(/\n\s*\n/).map(p => '<p class="hud-note">' + p + '</p>').join('') })
      if (!briefing.audioUrl) {
        s.setError('Seu briefing está pronto em texto. O áudio aguarda a conexão do OpenSpeaker ou a conclusão da geração.')
        return false
      }
      clearIdle()
      const spk = createSpeaker()
      const currentTurn = turn.current
      speaker.current = spk
      s.setPhase('speaking')
      spk.clip(BRIDGE_HTTP_URL + briefing.audioUrl, briefing.text)
      const abort = () => spk.cancel()
      signal.addEventListener('abort', abort, {once:true})
      try { await spk.end() } finally { signal.removeEventListener('abort', abort) }
      if (speaker.current === spk && turn.current === currentTurn) goDormant()
      return turn.current !== currentTurn ? 'cancelled' : spk.clipCompleted() && !signal.aborted
    }), [])

  return (
    <>
      <Scene />
      <Hud />
      <Console onSend={(text) => { silence(); interrupt(); void respond(text) }} onStart={() => void powerOn()} onStop={() => { turn.current++; interrupt(); goDormant() }} onTestVoice={() => void previewVoice()} onRead={(text) => void previewVoice(text)} onMute={() => silence()} />
      <Boot />
      <Diagnostics />
    </>
  )
}
