// Single point to swap signaling strategy: change the import subpath
// (e.g. 'trystero/torrent') if nostr relays misbehave.
export { joinRoom } from 'trystero/nostr'

export const APP_ID = 'seehub-v1'

// Sync tuning (seconds unless noted)
export const HEARTBEAT_MS = 4000
export const HARD_SEEK_THRESHOLD = 1.5 // drift above this → hard seek
export const SOFT_DRIFT_THRESHOLD = 0.4 // drift above this → playbackRate nudge
export const RATE_NUDGE = 0.05
export const SEEK_DEDUPE = 0.3 // incoming seek within this of current pos → ignore

// TURN credentials are injected at build time (Vite env / GitHub Actions
// secrets) so they aren't committed in source. Without TURN, two peers behind
// symmetric NAT — e.g. two mobile-carrier hotspots (CGNAT) — cannot connect.
// TURN only relays the WebRTC datachannel (sync messages, a few KB/session);
// the video stream is pulled directly from the CDN by each peer.
const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined
const TURN_USER = import.meta.env.VITE_TURN_USER as string | undefined
const TURN_CRED = import.meta.env.VITE_TURN_CRED as string | undefined

const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
if (TURN_URL && TURN_USER && TURN_CRED) {
  iceServers.push({
    urls: TURN_URL.split(',').map((u) => u.trim()),
    username: TURN_USER,
    credential: TURN_CRED,
  })
}

export const RTC_CONFIG: RTCConfiguration = { iceServers }

