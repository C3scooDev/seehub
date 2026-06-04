export type Ctrl =
  | { type: 'play'; position: number; sentAt: number }
  | { type: 'pause'; position: number; sentAt: number }
  | { type: 'seek'; position: number; sentAt: number }
  | { type: 'heartbeat'; position: number; paused: boolean; sentAt: number }

// Host → joiner full resync on peer join.
export type StateMsg = {
  url: string
  position: number
  paused: boolean
  sentAt: number
}

export type UrlMsg = {
  url: string
  position?: number
  reason?: 'load' | 'token-refresh'
}

// Host switched episode → every peer must re-extract its OWN m3u8 for `ep`
// (tokens are IP-bound) and reload from the start.
export type EpisodeMsg = {
  ep: string
  sentAt: number
}

// Debug: test whether the host's raw m3u8 token works from the peer's IP.
// `url` = host asking the peer to probe it; `result` = peer's reply.
export type ProbeMsg = {
  url?: string
  result?: string
}

export type PlayerState = {
  url: string | null
  position: number
  paused: boolean
}
