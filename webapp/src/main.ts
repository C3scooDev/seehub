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

function inviteUrl(roomId: string): string {
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('room', roomId)
  return url.toString()
}

function isEpisodeUrl(ep: string): boolean {
  return /^https?:\/\/.*\/watch\/\d+/.test(ep) && /[?&]e=\d+/.test(ep)
}

function enterRoom(roomId: string) {
  showRoomView(inviteUrl(roomId))
  setStatus(0)

  const room = new SyncRoom(roomId)

  // Wiring is circular (player events → sync, sync → player), so create the
  // player first with callbacks that forward to the engine once it exists.
  let engine: SyncEngine
  const player = new Player(ui.video(), {
    onUserPlay: (pos) => engine.userPlay(pos),
    onUserPause: (pos) => engine.userPause(pos),
    onUserSeek: (pos) => engine.userSeek(pos),
    onFatalError: (kind) => engine.notifyMediaFailed(kind),
  })

  // Episode the host last extracted — distinguishes a real episode change
  // (restart from 0) from a token refresh of the same episode (keep position).
  let currentEpisode: string | null = null

  engine = new SyncEngine(player, room, {
    onPeersChanged: (count) => setStatus(count),
    // A peer received the host's shared stream and loaded it.
    onRemoteUrl: () => toast('In sync con l’host ✓'),
    onConnLost: () => toast('Connessione persa — mi riallineo appena torna la rete…', 4000),
    onMediaFailed: () =>
      toast('Riproduzione persa più volte (token scaduto?). L’host ri-estragga l’episodio.', 5000),
  })

  // Central entry point for any m3u8 the HOST obtains (extension or paste).
  // It loads locally and is shared with every peer over the room.
  function load(url: string) {
    const trimmed = url.trim()
    if (!/^https?:\/\//.test(trimmed)) {
      toast('URL non valido')
      return
    }
    const reload = player.hasUrl
    engine.userLoad(trimmed)
    toast(reload ? 'Stream aggiornato' : 'Video caricato')
  }

  // Ask the browser extension (host only) to resolve an episode URL to an m3u8
  // natively (background fetch). No-op without the extension.
  let resolveTimer: number | undefined
  function requestResolve(ep: string) {
    if (!ep) return
    if (!isEpisodeUrl(ep)) {
      toast('URL episodio non valido (serve un link …/watch/<id>?e=<ep>)')
      return
    }
    window.postMessage({ type: 'SEEHUB_RESOLVE', ep }, location.origin)
    toast('Estrazione in corso…')
    clearTimeout(resolveTimer)
    resolveTimer = window.setTimeout(() => {
      if (!player.hasUrl) toast('Nessuna risposta: estensione installata? Apri lo stesso browser.')
    }, 12000)
  }

  ui.copyInviteBtn().addEventListener('click', () => {
    void navigator.clipboard.writeText(ui.inviteLink().value)
    toast('Link copiato ✓')
  })

  // Host loads/changes the episode. A different episode restarts from 0 for
  // everyone; the same episode again is a token refresh (position preserved).
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
    requestResolve(ep)
  }

  ui.episodeLoadBtn().addEventListener('click', () => {
    hostLoadEpisode(ui.episodeInput().value.trim())
  })
  ui.episodeInput().addEventListener('change', () => {
    hostLoadEpisode(ui.episodeInput().value.trim())
  })

  // Host manual fallback: paste an m3u8 directly.
  ui.loadBtn().addEventListener('click', () => load(ui.m3u8Input().value))

  // Auto-load from the browser extension bridge (host side): it posts the
  // captured/resolved m3u8 into the page so the host never pastes anything.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.type === 'SEEHUB_M3U8' && typeof event.data.url === 'string') {
      clearTimeout(resolveTimer)
      load(event.data.url)
    } else if (event.data?.type === 'SEEHUB_M3U8_ERR') {
      clearTimeout(resolveTimer)
      toast('Estrazione fallita: ' + (event.data.error || 'errore') + '. Riprova / ricarica l’episodio.')
    }
  })

  // m3u8 handed over via query param (host extension/Shortcut deep-link).
  const m3u8 = new URLSearchParams(location.search).get('m3u8')
  if (m3u8) {
    load(m3u8)
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
