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
  url.search = `?room=${roomId}`
  return url.toString()
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
    onFatalError: (kind) => {
      if (kind === 'network') {
        toast('Stream scaduto o irraggiungibile: ri-estrai il link m3u8 e ricaricalo')
        ui.loadHint().textContent =
          'Token probabilmente scaduto (~6h). Ri-estrai con l’estensione e incolla qui: la posizione viene mantenuta.'
      } else {
        toast('Errore di riproduzione')
      }
    },
  })

  engine = new SyncEngine(player, room, {
    onPeersChanged: (count) => setStatus(count),
    onRemoteUrl: () => {
      ui.m3u8Input().placeholder = 'Video caricato dall’host'
      toast('Video ricevuto dal peer')
    },
  })

  ui.copyInviteBtn().addEventListener('click', () => {
    void navigator.clipboard.writeText(ui.inviteLink().value)
    toast('Link copiato ✓')
  })

  ui.loadBtn().addEventListener('click', () => {
    const url = ui.m3u8Input().value.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) {
      toast('URL non valido')
      return
    }
    // Re-load of a new URL while one is playing = token refresh (keeps position)
    const reason = player.hasUrl ? 'token-refresh' : 'load'
    engine.loadAsHost(url, reason)
    toast(reason === 'token-refresh' ? 'Stream aggiornato' : 'Video caricato, sei l’host')
  })

  // m3u8 handed over from the extension via query param
  const params = new URLSearchParams(location.search)
  const m3u8 = params.get('m3u8')
  if (m3u8) {
    ui.m3u8Input().value = m3u8
    // strip it from the address bar (it contains a token)
    const clean = new URL(location.href)
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
