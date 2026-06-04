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

// Name the user must give the imported Apple Shortcut.
const SHORTCUT_NAME = 'SeeHub'

function inviteUrl(roomId: string, episode?: string): string {
  const url = new URL(location.href)
  url.search = ''
  url.searchParams.set('room', roomId)
  if (episode) url.searchParams.set('ep', episode)
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

function enterRoom(roomId: string, initialEpisode: string | null) {
  showRoomView(inviteUrl(roomId, initialEpisode ?? undefined))
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

  // Episode currently loaded/targeted on THIS device. Lets us tell a real
  // episode change (re-extract from start, broadcast) from a token refresh of
  // the same episode (preserve position, no broadcast).
  let currentEpisode: string | null = initialEpisode

  engine = new SyncEngine(player, room, {
    onPeersChanged: (count) => setStatus(count),
    onNeedLocalUrl: (reason) => {
      const msg =
        reason === 'forbidden'
          ? 'Il token è legato all’IP: il link non vale sulla tua rete. Estrai il TUO con l’estensione e incollalo qui.'
          : reason === 'error'
            ? 'Errore di riproduzione. Ri-estrai il link e riprova.'
            : 'L’altra persona ha avviato l’episodio. Apri lo stesso episodio, estrai il TUO link con l’estensione e incollalo qui per sincronizzarti.'
      ui.loadHint().textContent = msg
      toast('Incolla il tuo link m3u8')
    },
    // The other peer switched episode → re-extract our own m3u8 for it.
    onRemoteEpisode: (ep) => {
      toast('L’altra persona ha cambiato episodio')
      driveGuestExtraction(ep)
    },
  })

  // Last raw m3u8 loaded on THIS device — used by the IP-binding probe.
  let lastRawUrl: string | null = null

  // Central entry point for any m3u8 we obtain (manual, extension, Shortcut).
  function load(url: string) {
    const trimmed = url.trim()
    if (!/^https?:\/\//.test(trimmed)) {
      toast('URL non valido')
      return
    }
    const reload = player.hasUrl
    lastRawUrl = trimmed
    engine.userLoad(trimmed)
    ui.extractPanel().classList.add('hidden')
    toast(reload ? 'Stream aggiornato' : 'Video caricato')
  }

  // DEBUG: does the host's raw token work from the peer's IP? Host sends its
  // m3u8; the peer fetches it from its OWN browser/IP and reports the status.
  // 200 = shareable (not IP-bound); throw/non-200 = IP-bound, keep per-peer.
  ui.probeBtn().addEventListener('click', () => {
    if (!lastRawUrl) {
      toast('Carica prima il TUO video, poi testa')
      return
    }
    room.sendProbe({ url: lastRawUrl })
    toast('Test inviato al peer…')
  })
  room.onProbe(async (msg) => {
    if (msg.url) {
      // We are the peer: probe the host's URL from our IP.
      let result: string
      try {
        const r = await fetch(msg.url, { method: 'GET' })
        result = r.ok ? `${r.status} OK — CONDIVISIBILE` : `${r.status} (bloccato)`
      } catch {
        result = 'bloccato (403/rete, niente CORS)'
      }
      console.log('[probe] host url from my IP:', result)
      toast('Test ricevuto: ' + result, 6000)
      room.sendProbe({ result })
    } else if (msg.result) {
      // We are the host: show the peer's verdict.
      console.log('[probe] peer verdict:', msg.result)
      toast('PEER → ' + msg.result, 8000)
    }
  })

  // Ask the browser extension (if installed) to resolve an episode URL to an
  // m3u8 natively (background fetch, from this machine's IP). No-op without it.
  let resolveTimer: number | undefined
  function requestResolve(ep: string) {
    if (!ep) return
    if (!isEpisodeUrl(ep)) {
      toast('URL episodio non valido (serve un link …/watch/<id>?e=<ep>)')
      return
    }
    window.postMessage({ type: 'SEEHUB_RESOLVE', ep }, location.origin)
    toast('Estrazione in corso…')
    // If nothing loads, the extension is missing or the resolve failed.
    clearTimeout(resolveTimer)
    resolveTimer = window.setTimeout(() => {
      if (!player.hasUrl) toast('Nessuna risposta: estensione installata? Apri lo stesso browser.')
    }, 9000)
  }

  ui.copyInviteBtn().addEventListener('click', () => {
    void navigator.clipboard.writeText(ui.inviteLink().value)
    toast('Link copiato ✓')
  })

  // Host loads/changes the episode. A different episode is broadcast to the
  // peer (it re-extracts its own m3u8 and restarts); the same episode again is
  // just a token refresh (no broadcast, position preserved).
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

  // Host fills the episode URL → invite link gains ?ep= so the guest can be
  // driven hands-off (iPad Shortcut / desktop extension).
  ui.episodeInput().addEventListener('input', () => {
    const ep = ui.episodeInput().value.trim()
    ui.inviteLink().value = inviteUrl(roomId, ep || undefined)
  })
  // Explicit button + commit (blur/enter) both trigger load/change.
  ui.episodeLoadBtn().addEventListener('click', () => {
    hostLoadEpisode(ui.episodeInput().value.trim())
  })
  ui.episodeInput().addEventListener('change', () => {
    hostLoadEpisode(ui.episodeInput().value.trim())
  })

  ui.loadBtn().addEventListener('click', () => load(ui.m3u8Input().value))

  // Auto-load from the browser extension bridge (it posts the captured m3u8
  // into the SeeHub page so the guest never pastes anything).
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

  const params = new URLSearchParams(location.search)

  // m3u8 handed over via query param (extension or Shortcut)
  const m3u8 = params.get('m3u8')
  if (m3u8) {
    load(m3u8)
    const clean = new URL(location.href) // strip token from the address bar
    clean.searchParams.delete('m3u8')
    history.replaceState(null, '', clean)
  }

  // Guest side: extract our OWN m3u8 for `ep` (token is IP-bound). Used both
  // for the invite's initial ?ep and when the host changes episode mid-session.
  // .onclick (not addEventListener) so repeated episode changes don't stack.
  function driveGuestExtraction(ep: string) {
    currentEpisode = ep
    ui.episodeInput().value = ep
    ui.extractPanel().classList.remove('hidden')
    if (isIOS()) {
      ui.extractBtn().textContent = '▶︎ Avvia'
      ui.extractHint().textContent =
        'iPad: tocca Avvia → lo Shortcut "SeeHub" estrae il tuo link e ti riporta qui sincronizzato.'
      ui.extractBtn().onclick = () => {
        const input = encodeURIComponent(roomId + '|' + ep)
        location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=${input}`
      }
    } else {
      // Desktop with the extension: resolves automatically in the background.
      requestResolve(ep)
      ui.extractBtn().textContent = '▶︎ Apri episodio'
      ui.extractHint().textContent =
        'PC: con l’estensione SeeHub il video si carica da solo. Se non parte, tocca per aprire l’episodio.'
      ui.extractBtn().onclick = () => window.open(ep, '_blank')
    }
  }

  // Guest helper: invite carried an episode and we have no stream yet.
  const episode = params.get('ep')
  if (episode && !m3u8) driveGuestExtraction(episode)
}

function init() {
  const params = new URLSearchParams(location.search)
  const roomId = params.get('room')

  if (roomId) {
    enterRoom(roomId, params.get('ep'))
    return
  }

  ui.createRoomBtn().addEventListener('click', () => {
    const id = randomRoomId()
    const url = new URL(location.href)
    url.searchParams.set('room', id)
    history.replaceState(null, '', url)
    enterRoom(id, null)
  })
}

init()
