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
  })

  // Central entry point for any m3u8 we obtain (manual, extension, Shortcut).
  function load(url: string) {
    const trimmed = url.trim()
    if (!/^https?:\/\//.test(trimmed)) {
      toast('URL non valido')
      return
    }
    const reload = player.hasUrl
    engine.userLoad(trimmed)
    ui.extractPanel().classList.add('hidden')
    toast(reload ? 'Stream aggiornato' : 'Video caricato')
  }

  // Ask the browser extension (if installed) to resolve an episode URL to an
  // m3u8 natively (background fetch, from this machine's IP). No-op without it.
  function requestResolve(ep: string) {
    if (ep) window.postMessage({ type: 'SEEHUB_RESOLVE', ep }, location.origin)
  }

  ui.copyInviteBtn().addEventListener('click', () => {
    void navigator.clipboard.writeText(ui.inviteLink().value)
    toast('Link copiato ✓')
  })

  // Host fills the episode URL → invite link gains ?ep= so the guest can be
  // driven hands-off (iPad Shortcut / desktop extension).
  ui.episodeInput().addEventListener('input', () => {
    const ep = ui.episodeInput().value.trim()
    ui.inviteLink().value = inviteUrl(roomId, ep || undefined)
  })
  // On commit (blur/enter), let the extension load the host's own video too.
  ui.episodeInput().addEventListener('change', () => {
    requestResolve(ui.episodeInput().value.trim())
  })

  ui.loadBtn().addEventListener('click', () => load(ui.m3u8Input().value))

  // Auto-load from the browser extension bridge (it posts the captured m3u8
  // into the SeeHub page so the guest never pastes anything).
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== 'SEEHUB_M3U8') return
    if (typeof event.data.url === 'string') load(event.data.url)
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

  // Guest helper: invite carried an episode and we have no stream yet.
  const episode = params.get('ep')
  if (episode && !m3u8) {
    ui.episodeInput().value = episode
    const panel = ui.extractPanel()
    panel.classList.remove('hidden')
    if (isIOS()) {
      ui.extractHint().textContent =
        'iPad: tocca Avvia → lo Shortcut "SeeHub" estrae il tuo link e ti riporta qui sincronizzato.'
      ui.extractBtn().addEventListener('click', () => {
        const input = encodeURIComponent(roomId + '|' + episode)
        location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=${input}`
      })
    } else {
      // Desktop with the extension: resolves automatically in the background.
      requestResolve(episode)
      ui.extractBtn().textContent = '▶︎ Apri episodio'
      ui.extractHint().textContent =
        'PC: con l’estensione SeeHub il video si carica da solo. Se non parte, tocca per aprire l’episodio.'
      ui.extractBtn().addEventListener('click', () => window.open(episode, '_blank'))
    }
  }
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
