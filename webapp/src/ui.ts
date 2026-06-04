function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing element #${id}`)
  return node as T
}

export const ui = {
  landing: () => el<HTMLElement>('landing'),
  roomView: () => el<HTMLElement>('room-view'),
  createRoomBtn: () => el<HTMLButtonElement>('create-room'),
  inviteLink: () => el<HTMLInputElement>('invite-link'),
  copyInviteBtn: () => el<HTMLButtonElement>('copy-invite'),
  episodeInput: () => el<HTMLInputElement>('episode-input'),
  episodeLoadBtn: () => el<HTMLButtonElement>('episode-load'),
  extractPanel: () => el<HTMLElement>('extract-panel'),
  extractBtn: () => el<HTMLButtonElement>('extract-btn'),
  extractHint: () => el<HTMLElement>('extract-hint'),
  m3u8Input: () => el<HTMLInputElement>('m3u8-input'),
  loadBtn: () => el<HTMLButtonElement>('load-m3u8'),
  probeBtn: () => el<HTMLButtonElement>('probe-btn'),
  loadHint: () => el<HTMLElement>('load-hint'),
  video: () => el<HTMLVideoElement>('video'),
}

export function showRoomView(inviteUrl: string) {
  ui.landing().classList.add('hidden')
  ui.roomView().classList.remove('hidden')
  ui.inviteLink().value = inviteUrl
}

export function setStatus(peerCount: number) {
  const status = el<HTMLElement>('status')
  const text = el<HTMLElement>('status-text')
  if (peerCount > 0) {
    status.classList.add('connected')
    text.textContent = `connesso · ${peerCount + 1} 👤`
  } else {
    status.classList.remove('connected')
    text.textContent = 'in attesa del peer…'
  }
}

let toastTimer: number | undefined
export function toast(message: string, ms = 2500) {
  const node = el<HTMLElement>('toast')
  node.textContent = message
  node.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => node.classList.remove('show'), ms)
}
