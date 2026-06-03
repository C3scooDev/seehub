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

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // If direct P2P fails (symmetric NAT both sides), enable a TURN relay:
    // {
    //   urls: 'turn:standard.relay.metered.ca:443',
    //   username: '<metered.ca free-tier username>',
    //   credential: '<credential>',
    // },
  ],
}
