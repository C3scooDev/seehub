import { Player } from './player'
import { SyncRoom } from './room'
import { SyncEngine } from './sync'
import { ui, showRoomView, setStatus, toast } from './ui'

function randomRoomId(): string {
  // 128-bit code: it's both the room address and the encryption secret, and it
  // only ever lives in the invite link (never typed), so favour entropy.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(26))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

// Name the user must give the imported Apple Shortcut (iPad fallback).
const SHORTCUT_NAME = 'SeeHub'

function inviteUrl(roomId: string): string {
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('room', roomId)
  return url.toString()
}

function isEpisodeUrl(ep: string): boolean {
  return /^https?:\/\/.*\/watch\/\d+/.test(ep) && /[?&]e=\d+/.test(ep)
}

function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports as desktop Mac; detect via touch points.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function enterRoom(roomId: string) {
  showRoomView(inviteUrl(roomId))
  setStatus(0)

  const room = new SyncRoom(roomId)

  let engine: SyncEngine
  const player = new Player(ui.video(), {
    onUserPlay: (pos) => engine.userPlay(pos),
    onUserPause: (pos) => engine.userPause(pos),
    onUserSeek: (pos) => engine.userSeek(pos),
    onFatalError: (kind) => engine.notifyMediaFailed(kind),
  })

  // Episode the host last extracted — to tell a real episode change from a
  // token refresh of the same episode.
  let currentEpisode: string | null = null
  // Whether the next extension extraction is for US as a guest (load own token,
  // don't broadcast) or as the host (load + share the episode).
  let resolveMode: 'host' | 'guest' = 'host'

  engine = new SyncEngine(player, room, {
    onPeersChanged: (count) => setStatus(count),
    // The host shared an episode → extract OUR OWN token for it.
    onNeedSelfExtract: (ep) => driveGuestExtraction(ep),
    onRemoteUrl: () => toast('In sync ✓'),
    onConnLost: () => toast('Connessione persa — mi riallineo appena torna la rete…', 4000),
    onMediaFailed: () => toast('Token scaduto — ri-estraggo il tuo link…', 4000),
  })

  // Ask the browser extension to resolve an episode URL → m3u8 (own IP/token).
  let resolveTimer: number | undefined
  function requestResolve(ep: string, mode: 'host' | 'guest') {
    if (!ep || !isEpisodeUrl(ep)) {
      toast('URL episodio non valido (serve un link …/watch/<id>?e=<ep>)')
      return
    }
    resolveMode = mode
    window.postMessage({ type: 'SEEHUB_RESOLVE', ep }, location.origin)
    toast('Estrazione del tuo link in corso…')
    clearTimeout(resolveTimer)
    resolveTimer = window.setTimeout(() => {
      if (!player.hasUrl) toast('Nessuna risposta: estensione SeeHub installata su questo browser?')
    }, 12000)
  }

  ui.copyInviteBtn().addEventListener('click', () => {
    void navigator.clipboard.writeText(ui.inviteLink().value)
    toast('Link copiato ✓')
  })

  // Host: load / change the episode. Different episode → everyone restarts and
  // re-extracts; same episode → token refresh.
  function hostLoadEpisode(ep: string) {
    if (!ep) return
    if (!isEpisodeUrl(ep)) {
      toast('URL episodio non valido (serve un link …/watch/<id>?e=<ep>)')
      return
    }
    if (ep !== currentEpisode) {
      currentEpisode = ep
      engine.userChangeEpisode(ep)
    }
    requestResolve(ep, 'host')
  }

  ui.episodeLoadBtn().addEventListener('click', () => hostLoadEpisode(ui.episodeInput().value.trim()))
  ui.episodeInput().addEventListener('change', () => hostLoadEpisode(ui.episodeInput().value.trim()))

  // Host manual fallback: paste an m3u8 directly (becomes host).
  ui.loadBtn().addEventListener('click', () => {
    const url = ui.m3u8Input().value.trim()
    if (!/^https?:\/\//.test(url)) return toast('URL non valido')
    engine.userLoad(url, currentEpisode ?? undefined)
    toast('Video caricato')
  })

  // Guest side: extract OUR OWN token for `ep` (each peer needs its own — the
  // token is single-session). Desktop = extension (auto); iPad = Shortcut.
  function driveGuestExtraction(ep: string) {
    currentEpisode = ep
    ui.episodeInput().value = ep
    ui.extractPanel().classList.remove('hidden')
    if (isIOS()) {
      ui.extractBtn().textContent = '▶︎ Avvia'
      ui.extractHint().textContent =
        'iPad: tocca Avvia → lo Shortcut "SeeHub" estrae il TUO link e ti riporta qui sincronizzato.'
      ui.extractBtn().onclick = () => {
        const input = encodeURIComponent(roomId + '|' + ep)
        location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=${input}`
      }
    } else {
      // Desktop with the extension: resolves automatically in the background.
      requestResolve(ep, 'guest')
      ui.extractBtn().textContent = '↻ Ri-estrai'
      ui.extractHint().textContent =
        'Con l’estensione SeeHub il TUO link si estrae da solo. Se non parte, tocca per ritentare.'
      ui.extractBtn().onclick = () => requestResolve(ep, 'guest')
    }
  }

  // Extension delivers the resolved m3u8. Host shares the episode; a guest loads
  // its own token silently (only times sync after that).
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type === 'SEEHUB_M3U8' && typeof event.data.url === 'string') {
      clearTimeout(resolveTimer)
      ui.extractPanel().classList.add('hidden')
      if (resolveMode === 'guest') engine.loadOwnToken(event.data.url)
      else engine.userLoad(event.data.url, currentEpisode ?? undefined)
    } else if (event.data?.type === 'SEEHUB_M3U8_ERR') {
      clearTimeout(resolveTimer)
      toast('Estrazione fallita: ' + (event.data.error || 'errore') + '. Riprova / ricarica l’episodio.')
    }
  })

  // Deep link with ?m3u8 (iPad Shortcut returns the guest's own token).
  const m3u8 = new URLSearchParams(location.search).get('m3u8')
  if (m3u8) {
    engine.loadOwnToken(m3u8)
    const clean = new URL(location.href) // strip token from the address bar
    clean.searchParams.delete('m3u8')
    history.replaceState(null, '', clean)
  }
}

function init() {
  const params = new URLSearchParams(location.search)
  const roomId = params.get('room')

  if (roomId) {
    enterRoom(roomId)
    return
  }

  ui.createRoomBtn().addEventListener('click', () => {
    const id = randomRoomId()
    const url = new URL(location.href)
    url.searchParams.set('room', id)
    history.replaceState(null, '', url)
    enterRoom(id)
  })
}

init()
