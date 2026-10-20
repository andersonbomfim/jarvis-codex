/**
 * JARVIS local bridge.
 *
 * Runs the Claude Agent SDK — Claude Code as a library — and exposes one turn
 * of conversation over a WebSocket. The browser stays the face and the voice;
 * this process is the brain and the hands.
 *
 * Two things this buys over calling the Claude API from the browser:
 *   1. No API key. It authenticates exactly the way `claude` does, off your
 *      existing login, and bills to that same account.
 *   2. Every MCP server in your Claude Code config is available, including the
 *      local stdio ones a browser could never reach — higgsfield, elevenlabs,
 *      android, playwright, palmier-pro and the rest.
 *
 *   node bridge/server.mjs
 */

import { WebSocketServer } from 'ws'
import { query } from './codex-query.mjs'
import { publicProfile, personalContext, userProfileServer } from './user-profile.mjs'
import { closeCodex } from './codex-client.mjs'
import { loadPersonality, personalizedPrompt } from './personality.mjs'
import { userReviewServer } from './user-review.mjs'
import { projectsServer } from './projects.mjs'
import { discoveryServer } from './discovery.mjs'
import { knowledgeServer } from './knowledge.mjs'
import { backupJarvis, startBackups } from './backups.mjs'
import { windowsServer } from './windows.mjs'
import { workspaceRoute, filesServer } from './workspace.mjs'
import { openSpeakerEnabled } from './openspeaker-speech.mjs'
import { speechReply } from './speech-reply.mjs'
import { audioMime } from './openspeaker-speech.mjs'
import { morningBriefingRoute } from './morning-briefing.mjs'
import { voiceLibraryRoute } from './voice-library.mjs'
import { quickReplyFor } from '../shared/quick-replies.mjs'
import { politicalNewsRoute } from './political-news.mjs'
import { localSpeechAvailable, localTranscribe, warmLocalSpeech } from './local-speech.mjs'
warmLocalSpeech()
process.on('exit', closeCodex)
const stopBackups = startBackups()
process.on('exit', stopBackups)
import { displayServer } from './panels.mjs'
import { uiServer } from './ui.mjs'
import { visionServer } from './vision.mjs'
import { homedir, tmpdir } from 'node:os'
import { readFileSync, realpathSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { openRemote, proxyError, vetTarget, PROXY_UA } from './net.mjs'
import { probeUrl, renderPage } from './page.mjs'

const PORT = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)

/**
 * A crash here takes the whole assistant down mid-sentence, and most of what
 * can reject is out of our hands — a socket dying under a write, an upstream
 * fetch aborting. Log it and keep serving; the turn that failed will surface
 * its own error to the browser.
 */
process.on('unhandledRejection', (err) => {
  console.error('[jarvis] unhandled rejection:', err)
})

/**
 * Who is allowed to talk to this bridge.
 *
 * A WebSocket handshake is not subject to the same-origin policy: the browser
 * sends it on behalf of whatever page asked, no preflight stands in the way,
 * and the page reads every byte that comes back. Without a check here, any tab
 * the user happens to have open could open a socket to ws://localhost:8787,
 * drive the agent with every MCP server on this machine, and read back every
 * token and panel. The Origin header is the only thing that separates our own
 * dev server from someone else's page, so it is checked explicitly.
 *
 * A missing Origin means a non-browser client — curl, a script, a native app.
 * That is also exactly what local malware looks like, so it is refused on the
 * socket unless JARVIS_ALLOW_NO_ORIGIN=1 says otherwise.
 */
const EXTRA_ORIGINS = new Set(
  (process.env.JARVIS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),
)
const ALLOW_NO_ORIGIN = process.env.JARVIS_ALLOW_NO_ORIGIN === '1'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Vite takes the next free port when 5173 is busy and `vite preview` starts at
 * 4173, so the dev ranges are allowed rather than two exact numbers. Anything
 * else — including localhost on a port some other app is serving — has to be
 * named in JARVIS_ALLOWED_ORIGINS.
 */
const isDevPort = (port) =>
  (port >= 5173 && port <= 5199) || (port >= 4173 && port <= 4199)

function originAllowed(origin) {
  if (!origin) return ALLOW_NO_ORIGIN
  if (EXTRA_ORIGINS.has(origin.replace(/\/+$/, ''))) return true
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (!LOCAL_HOSTS.has(url.hostname)) return false
  return isDevPort(Number(url.port))
}

/**
 * Voice is a bad interface for a confirmation dialog: there is no window to
 * click and the model can't pause for one. So the bridge decides.
 *
 * Read-only and generative tools run freely. Anything that writes to disk,
 * runs a shell, or changes the world waits for JARVIS_ALLOW_WRITES=1. Start
 * without it, and turn it on once you trust what you're demoing.
 */
const ALLOW_WRITES = process.env.JARVIS_ALLOW_WRITES === '1'

/**
 * The orchestrator model. Override with JARVIS_MODEL to trade quality for pace
 * — claude-sonnet-5 is noticeably snappier on camera if Opus feels slow.
 */
const MODEL = process.env.JARVIS_MODEL || undefined

/**
 * How hard the model thinks before answering.
 *
 * This was 'low', on the reasoning that a voice assistant is judged on latency
 * — and that is true right up until the answer is thin. Low effort scopes the
 * work tightly to what was literally asked: fewer tool calls, less
 * cross-referencing, no second look. On a model of this tier that is leaving
 * most of it on the table.
 *
 * 'medium' is the compromise worth having here. It reasons and reaches for
 * tools noticeably more than 'low' while still answering inside the window a
 * spoken conversation tolerates. Raise it to 'high' or 'xhigh' when quality
 * matters more than pace; drop back to 'low' when filming and every second of
 * dead air shows.
 */
const EFFORT = process.env.JARVIS_EFFORT ?? 'medium'

/**
 * Both spellings of every renamed built-in are listed on purpose. The SDK
 * presents several tools to the model under newer names — Task is Agent,
 * BashOutput is TaskOutput, KillShell is TaskStop, and the MCP resource tools
 * gained a "Tool" suffix — so a set holding only the old names never matches
 * and the tool falls through to the write branch, which is the opposite of
 * what these lists mean. Keep both until the old names are certainly gone.
 */
const READ_ONLY_BUILTINS = new Set([
  'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite',
  'Task', 'Agent', 'ToolSearch',
  'ListMcpResources', 'ListMcpResourcesTool',
  'ReadMcpResource', 'ReadMcpResourceTool',
  'BashOutput', 'TaskOutput',
])
const WRITE_BUILTINS = new Set([
  'Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'KillShell', 'TaskStop',
])

/**
 * Every MCP server Claude Code has configured, read out of its own config.
 *
 * This does two jobs. The HUD wants the names while the boot animation plays,
 * and the agent doesn't emit its init message — and therefore its server
 * list — until the first user message flows through, which is far too late.
 * More importantly, this bridge turns filesystem settings off (see
 * settingSources below) and the SDK stops discovering these servers on its
 * own, so handing them over explicitly is what keeps the local stdio ones —
 * the whole reason the bridge exists — in play.
 *
 * Only the global block and the home-directory project scope, because
 * homedir() is our cwd. That makes the list a close but not exact match for
 * the agent's own: the 'ready' sent on connect comes from here and the second
 * one, sent from the init message a turn later, carries live status. Expect
 * the two to differ, and treat the later one as authoritative.
 */
function configuredServers() {
  try {
    return JSON.parse(readFileSync(join(import.meta.dirname, '..', 'jarvis.config.local.json'), 'utf8')).mcpServers ?? {}
  } catch { return {} }
}

const MCP_SERVERS = configuredServers()

/** MCP tools arrive as `mcp__<server>__<tool>`. */
const mcpServerOf = (toolName) =>
  toolName.startsWith('mcp__') ? toolName.split('__')[1] : null

/** The tool half, which can itself contain underscores: `mcp__x__a__b` -> `a__b`. */
const mcpToolOf = (toolName) => toolName.split('__').slice(2).join('__')

/**
 * MCP policy, and why it is shaped this way.
 *
 * A short list of "servers that can change things" is the wrong default,
 * because it is a list of what we happened to think of. Every server not on it
 * runs unconditionally — and on a real machine that quietly includes placing a
 * phone call, spending an advertising budget, deleting a generated character
 * and writing files to disk. A voice assistant cannot ask "are you sure", so
 * the bridge has to be the one that is sure.
 *
 * So the default is deny, softened in two ways so the demo stays usable:
 *
 *   1. READ_ONLY_MCP is an explicit allowlist of servers whose whole surface is
 *      lookups and generation — search, registries, analytics reads. Anything
 *      there runs in read-only mode.
 *   2. Everywhere else, the tool has to argue for itself: its own name must
 *      begin with a read verb. `list_devices` runs; `install_apk` does not.
 *
 * On top of both sits a veto: a name containing a plainly effectful verb needs
 * ALLOW_WRITES no matter which server it came from, which is what keeps
 * `make_outbound_call` and `download_lottie` still until you ask for them.
 */
const READ_ONLY_MCP = new Set([
  'exa', 'exa-code', 'serper', 'serpapi', 'lottie-search', 'mcp-registry',
  'openrouter', 'openrouter-image', 'Microsoft_Clarity',
  // The generation servers belong here too, and leaving them out was a real
  // regression: `generate_image` begins with no read verb, so it fell to the
  // deny branch and "generate an image of the Mark VII suit" — the headline
  // demo — stopped working in the default mode.
  //
  // Putting them on the allowlist is safe because the veto below still applies
  // to allowlisted servers: it is what continues to withhold
  // make_outbound_call, delete_character, create_* and edit_image. Generation
  // runs; acting on the world does not.
  'higgsfield', 'heygen', 'elevenlabs',
])

/**
 * Anchored on the tool name, so it reads the verb rather than the noun.
 * `screenshot` is in here because it is a read that doesn't sound like one,
 * and the persona is told in as many words to put screenshots on the display.
 */
const READ_VERB =
  /^(get|list|read|search|find|query|fetch|check|describe|inspect|show|view|explain|screenshot)/i

/**
 * Unanchored on purpose — `make_outbound_call` and `Bulk-Edit-Events` both
 * hide their verb in the middle. `download` is here because it writes a file
 * even though it sounds like a read.
 */
const EFFECTFUL_VERB =
  /(send|call|post|create|delete|remove|update|edit|write|install|launch|tap|swipe|press|type|buy|pay|charge|publish|deploy|outbound|download)/i

/**
 * Tools whose names trip the veto without deserving it.
 *
 * The veto reads verbs out of names, which is the right instinct and
 * occasionally the wrong answer. `openrouter send-message` sends a prompt to a
 * language model and gets text back — nothing in the world changes — but it is
 * indistinguishable by name from sending mail. Asking a second model a question
 * is one of the better things this assistant can do, so it is named here
 * instead of being lost to a regex.
 *
 * Full `server__tool` keys, so an exemption can never leak across servers.
 */
const VETO_EXEMPT = new Set([
  'openrouter__send-message',
  'openrouter__send-feedback',
])

function decideTool(name) {
  if (READ_ONLY_BUILTINS.has(name)) return true
  if (WRITE_BUILTINS.has(name)) return ALLOW_WRITES

  const server = mcpServerOf(name)
  if (server) {
    // The HUD, and the interface controls beside it. Both run in this process
    // and draw on our own screen, so neither is something to withhold —
    // without them JARVIS has no display at all. They also have to be named
    // here rather than left to the verb rules below, which read `ui_theme` as
    // a write and would hold the whole surface back behind ALLOW_WRITES.
    if (server === 'jarvis' || server === 'jarvis_ui' || server === 'user_review' || server === 'personal') return true

    // The browser server gates itself, at construction: chromeServer() only
    // builds the acting tools — click, type, form input, close tab — when
    // ALLOW_WRITES is set, so anything that reaches here at all is something
    // the same policy has already permitted. Deciding it a second time by
    // reading verbs out of the name would only get it wrong: `chrome_navigate`
    // begins with no read verb and would fall to the write branch, which would
    // withhold the one tool the whole server is for.
    if (server === 'jarvis_chrome') return true

    // The camera. Not withheld behind ALLOW_WRITES: looking changes nothing,
    // and the real gate is the browser's own camera permission plus an
    // indicator the user can see for as long as it is live.
    if (server === 'jarvis_eyes') return true

    const tool = mcpToolOf(name)
    if (EFFECTFUL_VERB.test(tool) && !VETO_EXEMPT.has(`${server}__${tool}`)) {
      return ALLOW_WRITES
    }
    // The session tools this bridge is developed inside count as read-only too.
    if (READ_ONLY_MCP.has(server) || server.startsWith('ccd_session')) return true
    return READ_VERB.test(tool) ? true : ALLOW_WRITES
  }
  return ALLOW_WRITES
}

// The browser and the shell are where the prompt has to know which machine it
// is on. The `chrome_*` extension bridge does not run on Windows, so there the
// browser is the Chrome DevTools MCP server and shell commands go through Git
// Bash. Everywhere else keeps the user's own signed-in Chrome.
const CHROME_BROWSER = `Their browser — ALWAYS the \`chrome_*\` tools, first, for anything to do with a
browser or a web page:
- The \`chrome_*\` tools drive the user's own Chrome. It is already signed in to
  everything they use, it carries their real cookies, and it does not read as
  automation to the sites it visits.
- This is the FIRST thing you reach for on any browsing task: opening a page,
  reading one, searching a site, checking mail, a dashboard, a profile, an
  account, anything behind a login. Do not weigh it up against the
  alternatives — start here.
- But Chrome is your HANDS, not your display. Use it to reach and read things;
  then show what you found on a blade. Leaving the answer in a browser tab is
  not showing it — they are looking at this interface.
- NEVER use playwright, puppeteer, or any other browser automation server for
  this. They start from an empty profile with no session and a fingerprint that
  the sites worth visiting refuse on sight, so they land on a login wall or a
  bot check and waste the turn. Only consider one if \`chrome_status\` reports the
  browser is genuinely unreachable and the task cannot be done any other way.
- A plain search engine query is still fine for a fact you only need to know —
  what you must not do is drive some other browser.
- Read the page before acting on it, and take element references from that read
  rather than guessing where something is.
- Before anything that sends, buys, deletes or posts, say in one sentence what
  you are about to do. After it, say what happened.
- If the browser is unreachable, say so once and carry on without it.`

const WINDOWS_MACHINE = `Their browser — ALWAYS the \`mcp__chrome-devtools__*\` tools, first, for anything
to do with a browser or a web page:
- This machine is Windows, where the \`chrome_*\` extension bridge does not run.
  The Chrome DevTools server is the browser here: \`new_page\`, \`navigate_page\`,
  \`take_snapshot\`, \`click\`, \`fill\`, \`take_screenshot\`. Never mention which of
  the two you are using; it is simply "the browser".
- This is the FIRST thing you reach for on any browsing task: opening a page,
  reading one, searching a site, a dashboard, a profile, a video. Do not weigh
  it up against the alternatives — start here.
- YouTube is a browser job. Open the page, find the video, press play.
- It drives a Chrome window of its own, so it is NOT signed in to their
  accounts. Anything behind a login lands on a login wall: say so in one
  sentence rather than trying to get past it. When the answer lives in their
  mail, their Drive or their calendar, those tools hold it — use them instead.
- But Chrome is your HANDS, not your display. Use it to reach and read things;
  then show what you found on a blade. Leaving the answer in a browser tab is
  not showing it — they are looking at this interface.
- A plain search engine query is still fine for a fact you only need to know.
- Read the page before acting on it, and take element references from that read
  rather than guessing where something is.
- Before anything that sends, buys, deletes or posts, say in one sentence what
  you are about to do. After it, say what happened.
- If the browser is unreachable, say so once and carry on without it.

This machine — Windows, and the shell is yours:
- \`Bash\` runs here through Git Bash, and every Windows program is reachable
  from it. Opening, closing, listing and installing things is your work, not
  something to hand back to them with instructions.
- Close an app: \`taskkill //IM chrome.exe //F\`. The doubled slashes are not a
  typo — Git Bash rewrites single ones into paths and the command fails.
- Open an app, a file or a folder: \`start "" "vlc"\`.
- Software: \`winget install --id <id> -e\`, \`winget uninstall <name>\`,
  \`winget search <name>\` when you do not know the id, \`winget list\` for what is
  installed. A Windows administrator prompt may appear on their screen; tell
  them it is there and wait rather than reporting failure.
- What is running: \`tasklist\`.
- CONFIRM BEFORE, ALWAYS: shutting down, restarting, signing out, sleeping the
  machine, and deleting anything of theirs. One sentence saying exactly what you
  are about to do, then wait for a yes. This is not caution for its own sake —
  they are speaking to you, speech is misheard, and these are the commands where
  being misheard costs work that cannot be recovered. Shutdown is
  \`shutdown //s //t 0\`, restart \`shutdown //r //t 0\`, sign out \`shutdown //l\`.
- Closing an app is not in that list. Do it, then report it.`

const MACHINE = process.platform === 'win32' ? WINDOWS_MACHINE : CHROME_BROWSER

const SYSTEM_PROMPT = readFileSync(join(import.meta.dirname, 'persona.pt-BR.txt'), 'utf8')

/**
 * ElevenLabs credentials, borrowed from the MCP server config.
 *
 * If you've set up the elevenlabs MCP server, the key is already on this
 * machine — no reason to make you paste it into a second .env file. The browser
 * never sees it: it POSTs text to /tts here and gets audio back.
 */
function elevenKey() {
  // Community does not reuse another app's credentials or enable cloud STT implicitly.
  return null
}


/**
 * Where /file is permitted to read from, and how big a read may get.
 *
 * The roots are realpath'd once at boot so the containment check below compares
 * like with like — on macOS os.tmpdir() is a symlink into /private/var, and a
 * string prefix test against the unresolved form would reject every screenshot.
 */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // .svg is deliberately absent. An SVG is a scriptable document, and this
  // endpoint serves it from the bridge's own origin — the one origin allowed
  // to open the agent socket. A picture is not worth that.
}

const MAX_FILE_BYTES = 25 * 1024 * 1024

const FILE_ROOTS = [
  homedir(),
  // Both temp directories, because on macOS os.tmpdir() is the per-user
  // $TMPDIR under /var/folders while half the tools that take a screenshot
  // still write it to /tmp. Dropping one of them loses real panels.
  tmpdir(),
  '/tmp',
  ...(process.env.JARVIS_FILE_ROOTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
].map((root) => {
  try {
    return realpathSync(root)
  } catch {
    return resolvePath(root)
  }
})

/** True when `real` sits inside one of the roots, after both are resolved. */
const withinRoots = (real) =>
  FILE_ROOTS.some((root) => {
    const rel = relative(root, real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })

// ---------------------------------------------------------------------------

/**
 * Remote media, fetched by the bridge instead of by the page.
 *
 * JARVIS used to refuse to show anything he found on the web, and the refusal
 * was not squeamishness — a bare <img src="https://some-cdn/..."> in a panel
 * genuinely did not work. Three reasons, and all three are fixed by moving the
 * fetch to this side of the wire:
 *
 *   1. Hotlink blocking. News sites and image CDNs check Referer and User-Agent
 *      and hand a browser-that-isn't-their-page a 403 or a placeholder. That is
 *      why thumbnails rendered as empty rectangles. A server-side fetch that
 *      looks like an ordinary browser and sends no referrer gets the bytes.
 *   2. Privacy. Panel HTML is authored by a model that has just been reading
 *      untrusted web pages, so a remote URL in it is a prompt-injection beacon:
 *      load it directly and the user's IP, and the fact they asked, go to a host
 *      the page chose. Proxying means the browser only ever talks to localhost
 *      and the page CSP can stay tight.
 *   3. One place to cap size, set timeouts and insist the bytes really are the
 *      media type they claim.
 *
 * The cost is that this process — unlike a browser tab — can reach the user's
 * LAN, their router's admin page, and cloud metadata endpoints. So everything
 * below is an SSRF gate first and a proxy second.
 */

const MAX_IMG_BYTES = 15 * 1024 * 1024
const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const IMG_TIMEOUT_MS = 10_000
const MEDIA_TIMEOUT_MS = 30_000

// The SSRF gate and the guarded outbound clients now live in ./net.mjs, so the
// media proxy below and the page proxy share one implementation of the rules
// rather than two that can drift apart.

/**
 * The shared body of /img and /media.
 *
 * `kinds` is the list of content-type prefixes we are willing to hand back.
 * That check is load-bearing: without it this is an open proxy that will serve
 * an attacker's HTML from the bridge's own origin — the one origin allowed to
 * open the agent socket — which is the same reason IMAGE_TYPES has no .svg.
 */
async function proxyRemote(req, res, cors, { kinds, maxBytes, timeoutMs, ranged }) {
  const asked = new URL(req.url, 'http://x').searchParams.get('url') ?? ''
  const target = vetTarget(asked)

  const headers = {
    'user-agent': PROXY_UA,
    accept: ranged ? '*/*' : 'image/*,*/*;q=0.8',
    // Identity encoding so the byte cap counts the bytes we actually stream and
    // content-length means what it says. Media is already compressed anyway.
    'accept-encoding': 'identity',
  }
  // Range is the difference between a <video> that seeks and one Safari refuses
  // to play at all, so the browser's request is passed through verbatim.
  if (ranged && typeof req.headers.range === 'string') {
    headers.range = req.headers.range
  }

  const { res: upstream } = await openRemote(target, headers, timeoutMs)
  const status = upstream.statusCode ?? 0

  if (status !== 200 && status !== 206) {
    upstream.resume()
    throw proxyError(status === 404 ? 404 : 502, `upstream said ${status}`)
  }

  const type = String(upstream.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!kinds.some((kind) => type.startsWith(kind))) {
    upstream.resume()
    throw proxyError(415, `not ${kinds.join(' or ')} (got ${type || 'nothing'})`)
  }

  const declared = Number(upstream.headers['content-length'])
  if (Number.isFinite(declared) && declared > maxBytes) {
    upstream.resume()
    throw proxyError(413, 'too large')
  }

  const out = {
    ...cors,
    'content-type': type,
    'x-content-type-options': 'nosniff',
    // Thumbnails get looked at, panelled again, and re-rendered on every HUD
    // repaint; re-fetching from the CDN each time is slow and rude.
    'cache-control': 'private, max-age=600',
  }
  if (Number.isFinite(declared)) out['content-length'] = String(declared)
  if (ranged) {
    // Only claim range support when the origin actually demonstrated it — a
    // 206, or an explicit accept-ranges of its own. Plenty of hosts ignore the
    // Range header and hand back the whole file with a 200; advertising
    // accept-ranges on top of that tells the video element it may seek by
    // issuing byte requests that will never be honoured, and the scrub bar
    // then misbehaves in a way that looks like our bug rather than theirs.
    if (status === 206 || upstream.headers['accept-ranges'] === 'bytes') {
      out['accept-ranges'] = 'bytes'
    }
    if (upstream.headers['content-range']) {
      out['content-range'] = upstream.headers['content-range']
    }
  }
  res.writeHead(status, out)

  // Stream with a running cap. Buffering a 200 MB video into this process
  // would stall the token stream the voice is riding on, and trusting
  // content-length would let a host that lies about it eat the heap.
  let sent = 0
  upstream.on('data', (chunk) => {
    sent += chunk.length
    if (sent > maxBytes) {
      // Headers went out long ago, so a truncated body is the only way left to
      // say no. The player sees a short read; we see this line in the log.
      console.warn(`[jarvis] proxy cut ${target.href} at ${maxBytes} bytes`)
      upstream.destroy()
      res.destroy()
      return
    }
    if (!res.write(chunk)) {
      upstream.pause()
      res.once('drain', () => upstream.resume())
    }
  })
  upstream.on('end', () => res.end())
  upstream.on('error', () => res.destroy())
  req.on('close', () => upstream.destroy())
}

// ---------------------------------------------------------------------------

/**
 * CORS, reflected rather than wildcarded.
 *
 * `*` on this origin means any page on the internet can read whatever the
 * bridge serves, so the same allowlist that guards the socket picks the
 * header. A request carrying an Origin we don't know is refused outright —
 * but a request with no Origin at all is served, because an <img src> load
 * (which is how panels fetch screenshots) never sends one.
 */
function corsFor(req) {
  const origin = req.headers.origin
  const headers = { vary: 'origin' }
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-headers'] = 'content-type'
  }
  return headers
}

// One HTTP server for both the speech proxy and the WebSocket upgrade.
const http = await import('node:http')

const handleRequest = async (req, res) => {
  const origin = req.headers.origin
  if (origin && !originAllowed(origin)) {
    console.warn(`[jarvis] refused http request from origin ${origin}`)
    res.writeHead(403, { vary: 'origin' })
    return res.end('forbidden')
  }
  const cors = corsFor(req)
  if (req.method === 'GET' && req.url === '/client-profile') { res.writeHead(200,{...cors,'content-type':'application/json','cache-control':'no-store'}); return res.end(JSON.stringify(publicProfile())) }

  if (await workspaceRoute(req, res, cors, originAllowed)) return
  if (await morningBriefingRoute(req, res, cors)) return
  if (await voiceLibraryRoute(req, res, cors)) return
  if (await politicalNewsRoute(req, res, cors)) return

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/health') {
    // The browser reads this once at boot to decide which voice engine to use.
    // A configured ElevenLabs key selects its voice. Keep local Whisper first
    // for transcription; Edge remains available when no key is configured.
    const eleven = Boolean(elevenKey())
    const {enabled:personalityEnabled,reviewerEnabled,revision:profileRevision} = loadPersonality()
    const voiceClients = [...wss.clients].filter(client => client.voiceStatus).map(client => client.voiceStatus)
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, application: 'jarvis-codex-community', uiClients: wss.clients.size, voiceClients, personality:{enabled:personalityEnabled,reviewerEnabled,revision:profileRevision}, tts: openSpeakerEnabled(), stt: localSpeechAvailable() || eleven, sttEngine: localSpeechAvailable() ? 'local' : eleven ? 'elevenlabs' : 'browser', speechEngine: 'openspeaker', speechStatus: openSpeakerEnabled() ? 'ready' : 'connection_pending' }))
  }

  // Serve local image files to the page. Screenshots and generated art land on
  // disk as absolute paths, and a page served over http can't read file:// —
  // so the bridge, which can, hands them over.
  if (req.method === 'GET' && req.url?.startsWith('/file?')) {
    const asked = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
    // Resolve symlinks BEFORE judging anything. A name ending in .png can be a
    // link pointing at /etc/hosts, and checking the suffix the caller supplied
    // would wave that straight through — which is exactly how this endpoint
    // used to serve the contents of arbitrary system files.
    let real = null
    try {
      if (isAbsolute(asked)) real = await realpath(asked)
    } catch {
      real = null
    }
    const dot = real ? real.lastIndexOf('.') : -1
    const ext = dot === -1 ? '' : real.slice(dot).toLowerCase()
    // Images only, absolute paths only, and only under roots we expect things
    // to be written to. This endpoint exists to show pictures, not to be a
    // general file read for whatever the model — or another page — asks for.
    if (!real || !Object.hasOwn(IMAGE_TYPES, ext) || !withinRoots(real)) {
      res.writeHead(400, cors)
      return res.end('images only')
    }
    try {
      const info = await stat(real)
      if (!info.isFile() || info.size > MAX_FILE_BYTES) {
        res.writeHead(413, cors)
        return res.end('too large')
      }
      // Asynchronous because this process is also pumping the agent's token
      // stream; a synchronous read of a large screenshot stalls the voice.
      const body = await readFile(real)
      res.writeHead(200, {
        ...cors,
        'content-type': IMAGE_TYPES[ext],
        'x-content-type-options': 'nosniff',
      })
      return res.end(body)
    } catch {
      res.writeHead(404, cors)
      return res.end('not found')
    }
  }

  // Remote images, fetched here so the page never talks to the wider web. The
  // renderer rewrites every http(s) <img src> in a panel to this endpoint.
  if (req.method === 'GET' && req.url?.startsWith('/img?')) {
    try {
      await proxyRemote(req, res, cors, {
        kinds: ['image/'],
        maxBytes: MAX_IMG_BYTES,
        timeoutMs: IMG_TIMEOUT_MS,
        ranged: false,
      })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  // The same, for video and audio. Separate from /img because the limits and
  // the Range handling are genuinely different, not because the code is.
  if (req.method === 'GET' && req.url?.startsWith('/media?')) {
    try {
      await proxyRemote(req, res, cors, {
        kinds: ['video/', 'audio/'],
        maxBytes: MAX_MEDIA_BYTES,
        timeoutMs: MEDIA_TIMEOUT_MS,
        ranged: true,
      })
    } catch (err) {
      if (res.headersSent) return res.destroy()
      res.writeHead(err.status ?? 502, cors)
      return res.end(err.message ?? 'proxy failed')
    }
    return
  }

  // A whole web page, fetched here and served from this origin so it can be
  // framed. The publisher's X-Frame-Options and CORS rules are enforced against
  // the browser, and from the browser's point of view this document is ours —
  // so an article that refuses to be embedded anywhere still opens on the
  // display. See page.mjs for what each mode does to the markup.
  //
  // No Origin header arrives on an iframe navigation, so this rides the same
  // path as an <img> load through the check at the top of this handler.
  if (req.method === 'GET' && req.url?.startsWith('/page?')) {
    const asked = new URL(req.url, 'http://x')
    const target = asked.searchParams.get('url') ?? ''
    const mode = asked.searchParams.get('mode') === 'live' ? 'live' : 'reader'
    try {
      const page = await renderPage(target, mode, `http://localhost:${PORT}`)
      res.writeHead(200, { ...cors, ...page.headers })
      return res.end(page.body)
    } catch (err) {
      // Rendered as a page rather than returned as a status, because this lands
      // inside an iframe: a bare 502 body is a blank rectangle on the display,
      // which reads as the interface being broken rather than as the article
      // being unavailable.
      res.writeHead(err.status ?? 502, {
        ...cors,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      })
      return res.end(
        `<!doctype html><meta charset="utf-8"><style>
           body{margin:0;padding:26px;background:transparent;color:#7fb6bf;
                font:400 13px/1.6 ui-monospace,monospace}
           b{color:#cfe9ee;font-weight:500;display:block;margin-bottom:6px}
         </style><b>This page could not be opened.</b>${
           String(err?.message ?? 'unknown error').replace(/[<&]/g, '')
         }`,
      )
    }
  }

  if (req.method === 'POST' && req.url === '/tts') {
    let bytes = 0
    const chunks = []
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 16384) { res.writeHead(413, cors); res.end('Texto muito longo.'); req.resume(); return }
      chunks.push(chunk)
    }
    try {
      const { text } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (typeof text !== 'string' || !text.trim()) { res.writeHead(400, cors); return res.end('Texto vazio.') }
      if (!openSpeakerEnabled()) throw new Error('A voz está desativada.')
      const audio = await speechReply(text)
      if (!audio) { res.writeHead(204, cors); return res.end() }
      res.writeHead(200, { ...cors, 'content-type': audioMime(audio), 'cache-control': 'no-store' })
      return res.end(audio)
    } catch {
      res.writeHead(503, cors)
      return res.end('OpenSpeaker indisponivel. A conexao da API e a voz clonada precisam estar prontas. Nenhuma voz substituta foi gerada.')
    }
  }

  // Speech to text. The browser captures one spoken segment as a compressed
  // audio blob and posts the raw bytes here; the bridge hands them to
  // ElevenLabs Scribe and returns the transcript. This is what replaced the
  // browser's own SpeechRecognition — that API dies silently under always-on
  // use, and a server-side transcriber cannot. Detecting that the user is
  // speaking at all is done locally with voice-activity detection, which never
  // touches this endpoint; this is only for the words.
  if (req.method === 'POST' && req.url === '/stt') {
    if (localSpeechAvailable()) {
      if (!origin || !originAllowed(origin)) { res.writeHead(403, cors); return res.end('forbidden') }
      const chunks = []; let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 5 * 1024 * 1024) { res.writeHead(413, cors); return res.end('Trecho muito longo.') }
        chunks.push(chunk)
      }
      try {
        const text = await localTranscribe(Buffer.concat(chunks))
        res.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
        return res.end(JSON.stringify({ text }))
      } catch (error) { res.writeHead(503, cors); return res.end(error.message) }
    }
    const key = elevenKey()
    if (!key) {
      res.writeHead(503, cors)
      return res.end('no elevenlabs key')
    }

    const type = req.headers['content-type'] || 'audio/webm'
    const chunks = []
    let size = 0
    let overflowed = false
    // A few seconds of Opus is well under a megabyte; 25 MB is a generous
    // ceiling that still refuses a runaway stream before it eats the heap.
    for await (const chunk of req) {
      chunks.push(chunk)
      size += chunk.length
      if (size > 25 * 1024 * 1024) {
        overflowed = true
        break
      }
    }
    if (overflowed) {
      req.destroy()
      res.writeHead(413, cors)
      return res.end('audio too large')
    }
    // Silence, or a click. Nothing to transcribe, and calling out to the API
    // for it would only add latency to a non-answer.
    if (size < 1200) {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text: '' }))
    }

    try {
      // The filename extension is the only hint Scribe gets about the codec, so
      // derive it from the content-type the MediaRecorder reported rather than
      // hard-coding one.
      const ext = type.includes('ogg')
        ? 'ogg'
        : type.includes('mp4') || type.includes('mpeg')
          ? 'mp4'
          : type.includes('wav')
            ? 'wav'
            : 'webm'
      const form = new FormData()
      form.append('model_id', 'scribe_v1')
      form.append('language_code', 'por')
      form.append(
        'file',
        new Blob([Buffer.concat(chunks)], { type }),
        `speech.${ext}`,
      )

      const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: form,
      })
      if (!upstream.ok) {
        res.writeHead(upstream.status, cors)
        return res.end(await upstream.text())
      }
      const data = await upstream.json()
      res.writeHead(200, { ...cors, 'content-type': 'application/json' })
      return res.end(JSON.stringify({ text: (data.text ?? '').trim() }))
    } catch (err) {
      res.writeHead(502, cors)
      return res.end(String(err?.message ?? err))
    }
  }

  res.writeHead(404, cors)
  res.end()
}

const server = http.createServer((req, res) => {
  // The handler is async, so anything it throws would otherwise become an
  // unhandled rejection and leave the browser waiting on a socket that is
  // never going to answer.
  handleRequest(req, res).catch((err) => {
    console.error('[jarvis] request failed:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})

const wss = new WebSocketServer({
  server,
  // The handshake is the only place a page can be turned away, so it happens
  // here rather than after the socket is open. Rejections are logged loudly:
  // the likeliest cause is a dev server on an unexpected port, and a silent
  // 403 would look like the bridge simply isn't running.
  verifyClient: ({ origin, req }, done) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path !== '/' && path !== '/ws') {
      console.warn(`[jarvis] rejected websocket on path ${path}`)
      return done(false, 403, 'Forbidden')
    }
    if (!originAllowed(origin)) {
      console.warn(
        `[jarvis] rejected websocket from origin ${origin ?? '(none)'}` +
          ' — set JARVIS_ALLOWED_ORIGINS to permit it',
      )
      return done(false, 403, 'Forbidden')
    }
    done(true)
  },
})
// Loopback only. The Origin checks above are a browser convention, not
// authentication — anything else on the network can send whatever Origin it
// likes — so the bridge must not be reachable from another machine at all.
server.listen(PORT, '127.0.0.1')

console.log(`[jarvis] bridge listening on ws://localhost:${PORT}`)
console.log(
  `[jarvis] speech ${elevenKey() ? 'via ElevenLabs (key from MCP config)' : 'using browser fallback voice'}`,
)
console.log(`[jarvis] modelo ${MODEL ?? 'padrão do Codex'} · esforço ${EFFORT}`)
console.log(
  `[jarvis] writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'}` +
    (ALLOW_WRITES ? '' : ' — set JARVIS_ALLOW_WRITES=1 to permit shell/file/device actions'),
)
// Asynchronous, so it lands a beat after the rest of the banner. Worth printing
// at all because an extension that is simply not running is indistinguishable
// at the tool boundary from one that is broken, and this is the one place the
// difference can be stated before anybody asks a question that depends on it.
console.log('[jarvis] navegador via Chrome DevTools · inteligência via Codex')

console.log(
  '[jarvis] accepting local dev origins' +
    (EXTRA_ORIGINS.size ? ` plus ${[...EXTRA_ORIGINS].join(', ')}` : '') +
    (ALLOW_NO_ORIGIN ? ' and clients that send no origin' : ''),
)

/**
 * What to tell the browser when a turn ends badly. Plain sentences, because
 * whatever reaches the client is liable to be spoken.
 */
const RESULT_FAILURES = {
  error_during_execution: 'The turn failed part way through.',
  error_max_turns: 'The turn ran too long and was stopped.',
  error_max_budget_usd: 'The budget for this turn ran out.',
  error_max_structured_output_retries: 'The answer could not be assembled.',
  default: 'The turn ended without an answer.',
}

wss.on('connection', (socket) => {
  console.log('[jarvis] client connected')

  // Answer the HUD straight away rather than making it wait for the agent's
  // first turn. Refined later by the real init message.
  socket.send(
    JSON.stringify({ type: 'ready', servers: [] }),
  )

  /** Resolves the pending user message into the SDK's input generator. */
  let deliver = null
  let closed = false
  const inbox = []
  let contextRestored = false

  async function* userMessages() {
    while (!closed) {
      const request =
        inbox.shift() ??
        (await new Promise((resolve) => {
          deliver = resolve
        }))
      if (closed || request == null) return
      yield {
        type: 'user',
        message: { role: 'user', content: typeof request === 'string' ? request : request.text },
        effort: request.effort,
        parent_tool_use_id: null,
      }
    }
  }

  const send = (msg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  /**
   * Which question the agent is currently answering.
   *
   * The stream carries no notion of a turn, so without this the client cannot
   * tell the tail of an abandoned answer from the start of the new one — it
   * attaches a listener and receives whatever is on the socket. Echoing the
   * id the client sent lets it ignore anything that is not its own, which is
   * the only reliable fix: no amount of waiting on this side changes what a
   * listener over there has already heard.
   */
  let answering = null
  const sendTurn = (msg) => send({ ...msg, ask: answering })
  const personality = loadPersonality()
  const reviewer = personality.reviewerEnabled ? userReviewServer({model:MODEL}) : null

  /**
   * Asking the browser for something and waiting for the answer.
   *
   * Every other tool here pushes — a panel, a blade, a retint — and never needs
   * a reply. The camera is the exception: the hardware is over there and the
   * model is here, so a frame has to come back. Correlated by id because a turn
   * can have more than one request in flight, and timed out because a browser
   * that has been closed mid-question would otherwise hang the turn until the
   * two-minute idle timer noticed.
   */
  const waiting = new Map()
  let asks = 0

  const ask = (kind, args, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== socket.OPEN) {
        return reject(new Error('the interface is not connected'))
      }
      const id = `q${++asks}`
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error('the interface did not answer in time'))
      }, timeoutMs)
      waiting.set(id, { resolve, timer })
      send({ type: kind, id, ...args })
    })

  /**
   * Announcing a tool on the HUD, once, and only if it actually runs.
   *
   * A tool_use block surfaces twice — as a partial stream event and again on
   * the completed assistant message — so ids are remembered. The harder part
   * is timing, because a refused tool that lights the badge, plays the sound
   * and provokes a "working on it" line, for work that never happens, reads as
   * a bug on camera.
   *
   * The SDK's order is: the block starts streaming, then canUseTool is asked,
   * then the tool runs. So nothing is known at content_block_start. Announcing
   * from inside canUseTool would know the verdict but miss tools entirely —
   * measured on this SDK, the callback is consulted only for calls the CLI
   * hasn't already settled, so a `Bash: echo` its own classifier waves through
   * never reaches us at all.
   *
   * So: announce immediately for anything decideTool permits, since those run.
   * Hold the rest, and let the tool_result settle it — a refusal comes back as
   * is_error, anything else really did execute and has earned its badge, a
   * beat late. Nothing is ever announced for work that didn't happen.
   */
  const seenTools = new Set()
  const heldTools = new Map()

  /**
   * Resolves when the turn in flight has actually finished.
   *
   * Waiting on session.interrupt() alone is not enough. It resolves when the
   * agent has been *told* to stop, not when it has, so the last tokens of the
   * abandoned answer are still on their way — and since nothing on the wire
   * identifies which question a delta belongs to, they land on the next turn's
   * listener. Measured: ask for ALPHA, interrupt, ask for BRAVO, and BRAVO's
   * answer arrives as "ALPHA\nBRAVO".
   *
   * The SDK emits exactly one `result` per turn, so that is the boundary worth
   * waiting for. Raced against a timeout because a turn that never reports one
   * must not wedge the conversation for ever — a stray word is a blemish, a
   * deadlocked assistant is not.
   */
  let settling = Promise.resolve()
  let finishTurn = null

  const turnFinished = () =>
    new Promise((resolve) => {
      finishTurn = resolve
    })

  /**
   * A brief pause so the abandoned turn's frames are tagged with the OLD id
   * before the new one is adopted. Short, because correctness now comes from
   * the tag rather than from the wait — this only has to cover the gap, not
   * outlast the whole turn.
   */
  const SETTLE_CAP_MS = 400

  const announceTool = (id, name) => {
    if (!name || (id && seenTools.has(id))) return
    if (id) seenTools.add(id)
    // The display tool isn't work being done, it's the HUD drawing itself —
    // announcing it would put "jarvis · display" in the tool badge and trigger
    // a "working on it" filler for something already on screen.
    if (name === 'mcp__jarvis__display') return
    // The ui_* tools are the same case one step further: retinting the
    // interface is the interface talking about itself, not work being done for
    // the user, and the badge would be describing the very thing they can see.
    if (name.startsWith('mcp__jarvis_ui__')) return
    if (decideTool(name)) return sendTurn({ type: 'tool', name })
    if (id) heldTools.set(id, name)
  }

  const settleTool = (id, failed) => {
    const name = heldTools.get(id)
    if (name === undefined) return
    heldTools.delete(id)
    if (!failed) sendTurn({ type: 'tool', name })
  }

  const session = query({
    prompt: userMessages(),
    options: {
      // Everything Claude Code has configured, plus the HUD as an in-process
      // server. The HUD's handler closes over this socket, so a `display` call
      // lands on screen directly — which is also why this object is built per
      // connection rather than once.
      mcpServers: {
        ...MCP_SERVERS,
        windows: windowsServer(),
        personal: userProfileServer(),
        files: filesServer(),
        projects: projectsServer({onUpdate:()=>backupJarvis()}),
        discovery: discoveryServer(),
        knowledge: knowledgeServer(),
        ...(reviewer ? {user_review:reviewer} : {}),
        jarvis: displayServer(
          (panel) => send({ type: 'panel', panel }),
          (blade) => send({ type: 'blade', blade }),
        ),
        // The interface controls, on the same socket. A separate key because
        // MCP tool names are `mcp__<key>__<tool>` and one key can only carry
        // one server; the underscore in it is why decideTool and announceTool
        // both name `jarvis_ui` explicitly.
        jarvis_ui: uiServer((op, args) => send({ type: 'ui', op, args })),
        // The camera, which unlike everything else here has to ask and wait.
        jarvis_eyes: visionServer(ask),
      },
      // A plain system prompt, not the claude_code preset. The preset is
      // tuned for a coding agent — verbose, file-oriented, and a large chunk
      // of input tokens on every turn. Replacing it makes the persona stick,
      // keeps answers short enough to speak, and cuts cost per turn.
      systemPrompt: personalizedPrompt(SYSTEM_PROMPT + personalContext(), personality),
      sandbox: ALLOW_WRITES ? 'danger-full-access' : 'read-only',
      // Run from the home directory so project-scoped MCP servers don't shadow
      // the global ones, and so file tools have a sane root.
      cwd: resolvePath(import.meta.dirname, '..'),
      // No filesystem settings at all. Left to its default the SDK loads
      // ~/.claude/settings.json and settings.local.json exactly as the CLI
      // does — which on a working machine means a bypassPermissions default
      // and a pile of allow-rules for Bash. Allow-rules are matched before the
      // permission callback, so decideTool below would never even be asked
      // about the tools it most needs to refuse. Empty makes this bridge the
      // only authority. It also stops the global CLAUDE.md riding along on
      // every voice turn, carrying instructions written for a coding agent
      // into a conversation that is meant to be two sentences long.
      //
      // The cost is that MCP servers stop being discovered too, which is why
      // mcpServers above passes them in by hand.
      settingSources: [],
      // Stated explicitly, and it has to be.
      //
      // With no `model` here the SDK falls back to its own default, which on
      // this machine resolved to claude-opus-4-8[1m] — not what src/config.ts
      // declares for the browser-direct path, and not anything anyone chose.
      // Normally your own `/model` preference would decide, but that lives in
      // the settings files `settingSources: []` deliberately stops loading, so
      // without this line nothing in the project has a say at all.
      model: MODEL,
      effort: EFFORT,
      maxTurns: 24,
      permissionMode: 'default',
      // Without this the SDK only emits whole assistant messages, and JARVIS
      // would sit silent until the entire answer was written. Partial events
      // are what let speech start on the first finished sentence.
      includePartialMessages: true,
      // Signature is (toolName, input, options) and it must return a
      // PermissionResult object. Returning a bare boolean silently denies
      // everything, with the tool name arriving undefined.
      //
      // Worth knowing: this is a last gate, not the only one. Calls the CLI
      // has already settled never arrive here — its own classifier waves
      // through a `Bash: echo hello` without asking, and only reaches us for
      // something with a consequence, like a `touch`. So a deny here is
      // reliable; an absence of a call here is not proof nothing ran.
      canUseTool: async (toolName) => {
        const ok = decideTool(toolName)
        console.log(`[jarvis] tool ${toolName} -> ${ok ? 'allow' : 'deny'}`)
        return ok
          ? { behavior: 'allow' }
          : {
              behavior: 'deny',
              // Every word of this can end up spoken, so it carries no command
              // to read out — the persona is forbidden from saying one aloud.
              message:
                'Blocked: JARVIS is running in read-only mode and cannot take' +
                ' actions that change anything. Tell the user this action is' +
                ' unavailable until they enable write access on the machine.',
            }
      },
    },
  })

  // Pump the session's output stream to the browser for as long as it lives.
  ;(async () => {
    try {
      for await (const msg of session) {
        if (process.env.JARVIS_DEBUG === '1') {
          console.log('[msg]', msg.type, msg.event?.type ?? '')
        }

        switch (msg.type) {
          // Raw Anthropic stream events, surfaced by includePartialMessages.
          // This is the ONLY place spoken text arrives: there is no top-level
          // text_delta message in the SDK union and the 'assistant' message
          // carries no deltas either. Turn includePartialMessages off and
          // JARVIS goes completely mute.
          case 'stream_event': {
            const ev = msg.event
            if (
              ev?.type === 'content_block_delta' &&
              ev.delta?.type === 'text_delta' &&
              ev.delta.text
            ) {
              sendTurn({ type: 'text', delta: ev.delta.text })
            }
            if (
              ev?.type === 'content_block_start' &&
              ev.content_block?.type === 'tool_use'
            ) {
              announceTool(ev.content_block.id, ev.content_block.name)
            }
            break
          }

          case 'assistant': {
            // Fallback for builds that emit whole assistant messages rather
            // than partial events. Deduped against the stream_event path.
            for (const block of msg.content ?? msg.message?.content ?? []) {
              if (block.type === 'tool_use') {
                announceTool(block.id, block.name)
              }
            }
            break
          }

          case 'user': {
            // Tool results come back as a user message. This is the only place
            // a held announcement can be resolved: a refused tool arrives with
            // is_error set and stays off the HUD, anything else ran.
            const blocks = msg.message?.content
            if (!Array.isArray(blocks)) break
            for (const block of blocks) {
              if (block?.type === 'tool_result') {
                settleTool(block.tool_use_id, block.is_error === true)
              }
            }
            break
          }

          case 'result':
            // A result is not automatically a success. The error subtypes
            // carry no `result` field at all, so reporting them as 'done' with
            // empty text is indistinguishable from a turn that simply had
            // nothing to say — the HUD stops spinning and JARVIS stands there
            // silent. Say what happened instead.
            if (msg.subtype === 'success') {
              sendTurn({
                type: 'done',
                text: msg.result ?? '',
                costUsd: msg.total_cost_usd ?? null,
              })
            } else {
              console.error(
                `[jarvis] turn failed: ${msg.subtype}`,
                msg.errors ?? '',
              )
              sendTurn({
                type: 'error',
                message: RESULT_FAILURES[msg.subtype] ?? RESULT_FAILURES.default,
              })
            }
            // Whatever was waiting on this turn to finish can go now. This is
            // the only place a turn is genuinely over.
            finishTurn?.()
            finishTurn = null
            // One turn's tool ids are never referred to again, and these
            // otherwise grow for as long as the socket is open.
            seenTools.clear()
            heldTools.clear()
            break

          case 'system':
            if (msg.subtype === 'init') {
              // Servers report 'pending' until first use — they connect
              // lazily — so only drop the ones that are actually unusable.
              const usable = (msg.mcp_servers ?? [])
                .filter((s) => s.status !== 'needs-auth' && s.status !== 'failed')
                .map((s) => s.name)
              send({ type: 'ready', servers: usable })
              console.log(`[jarvis] ${usable.length} MCP servers available`)
            }
            break
        }
      }
    } catch (err) {
      console.error('[jarvis] session error:', err)
      send({ type: 'error', message: String(err?.message ?? err) })
      // The stream is finished either way — nothing will ever be read from it
      // again. Leaving the socket open would leave the client believing it has
      // a working bridge, and every later question would hang for ever waiting
      // on a pump that has already stopped. Close it so it reconnects.
      closed = true
      deliver?.(null)
      session.close?.()
      socket.close()
    }
  })()

  socket.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'voice-status' && msg.status && typeof msg.status === 'object') {
      const s = msg.status
      socket.voiceStatus = {
        at: new Date().toISOString(), desktop: s.desktop === true,
        live: s.live === true, muted: s.muted === true, enabled: s.enabled === true,
        ready: s.ready === true, recognizerLive: s.recognizerLive === true,
        context: String(s.context ?? '').slice(0, 30), label: String(s.label ?? '').slice(0, 180),
        level: Math.max(0, Math.min(1, Number(s.level) || 0)),
        segments: Math.max(0, Number(s.segments) || 0), transcribing: s.transcribing === true,
        heardAt: Math.max(0, Number(s.heardAt) || 0), wakes: Math.max(0, Number(s.wakes) || 0),
        accepted: Math.max(0, Number(s.accepted) || 0), mode: String(s.mode ?? '').slice(0, 20),
        phase: String(s.phase ?? '').slice(0, 20), sttError: String(s.sttError ?? '').slice(0, 120),
        droppedReason: String(s.droppedReason ?? '').slice(0, 100), sttMs: Math.max(0, Number(s.sttMs) || 0),
        completedSegments: Math.max(0, Number(s.completedSegments) || 0), lastSegmentBytes: Math.max(0, Number(s.lastSegmentBytes) || 0),
        audioEnabled: s.audioEnabled === true, playbackStarted: Math.max(0, Number(s.playbackStarted) || 0),
        playbackFailures: Math.max(0, Number(s.playbackFailures) || 0), playbackError: String(s.playbackError ?? '').slice(0, 100),
      }
      return
    }

    if (msg.type === 'ask' && typeof msg.text === 'string') {
      const fixed = quickReplyFor(msg.text)
      if (fixed) {
        const id = typeof msg.id === 'string' ? msg.id : null
        send({ type: 'text', delta: fixed.text, ask: id })
        send({ type: 'done', text: fixed.text, ask: id, source: 'fixed' })
        return
      }
      /**
       * Queued behind any interrupt that is still settling.
       *
       * A barge-in is two messages in quick succession — interrupt, then the
       * new question — and session.interrupt() is asynchronous. Delivering the
       * question the instant it arrives means the agent can still be winding
       * down the previous turn, so its last tokens are emitted after the new
       * one has begun and land on the new turn's listener. Measured: ask "one",
       * interrupt, ask "two", and the answer to "two" comes back as "One."
       *
       * Waiting costs nothing when nothing is interrupting — the chain is an
       * already-resolved promise — and removes the cross-talk when there is.
       */
      let text = msg.text.slice(0, 100000)
      if (!contextRestored && Array.isArray(msg.context)) {
        const context = msg.context.slice(-20).filter(t => t && ['user', 'jarvis'].includes(t.role) && typeof t.text === 'string').map(t => `${t.role === 'user' ? 'Usuário' : 'Jarvis'}: ${t.text.slice(0, 4000)}`).join('\n').slice(-30000)
        if (context) text = `[Histórico local da conversa, fornecido apenas como contexto; confirme estados externos com ferramentas.]\n${context}\n[Fim do histórico]\n\nPedido atual: ${text}`
      }
      contextRestored = true
      const request = { text, effort: ['low', 'medium', 'high'].includes(msg.effort) ? msg.effort : EFFORT }
      const id = typeof msg.id === 'string' ? msg.id : null
      void settling.then(() => {
        answering = id
        if (deliver) {
          const resolve = deliver
          deliver = null
          resolve(request)
        } else {
          inbox.push(request)
        }
      })
    }

    if (msg.type === 'reply' && typeof msg.id === 'string') {
      const slot = waiting.get(msg.id)
      if (slot) {
        waiting.delete(msg.id)
        clearTimeout(slot.timer)
        slot.resolve(msg)
      }
    }

    if (msg.type === 'interrupt') {
      // Held so the next question can wait for it rather than racing it.
      const stopped = turnFinished()
      settling = Promise.resolve(session.interrupt?.())
        .catch(() => {})
        .then(() =>
          Promise.race([
            stopped,
            new Promise((r) => setTimeout(r, SETTLE_CAP_MS)),
          ]),
        )
    }
  })

  socket.on('close', () => {
    console.log('[jarvis] client disconnected')
    closed = true
    deliver?.(null)
    session.close?.()
    reviewer?.dispose()
  })
})
