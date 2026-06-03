export const APP_ID = 'seehub-v1'

// Public MQTT-over-WebSocket broker used as the sync bus. No account needed;
// both peers connect outbound (works through CGNAT / symmetric NAT). All
// payloads are end-to-end encrypted (see crypto.ts), so the broker only sees
// opaque bytes on an unguessable, code-derived topic.
export const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'

// Presence: each client announces itself and pings; peers expire after timeout.
export const PRESENCE_PING_MS = 5000
export const PRESENCE_TIMEOUT_MS = 13000

// Sync tuning (seconds unless noted)
export const HEARTBEAT_MS = 4000
export const HARD_SEEK_THRESHOLD = 1.5 // drift above this → hard seek
export const SOFT_DRIFT_THRESHOLD = 0.4 // drift above this → playbackRate nudge
export const RATE_NUDGE = 0.05
export const SEEK_DEDUPE = 0.3 // incoming seek within this of current pos → ignore
