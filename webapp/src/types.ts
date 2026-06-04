export type Ctrl =
  | { type: 'play'; position: number; sentAt: number }
  | { type: 'pause'; position: number; sentAt: number }
  | { type: 'seek'; position: number; sentAt: number }
  | { type: 'heartbeat'; position: number; paused: boolean; sentAt: number }

// The vixcloud token is shareable across IPs (verified), so the host shares its
// extracted m3u8 directly and every peer loads it — no per-peer extraction.
// `fresh` = new episode (load from position); otherwise a token refresh / late
// resync of the SAME stream (align position, reload only if the URL changed).
export type UrlMsg = {
  url: string
  fresh: boolean
  position: number
  paused: boolean
}

export type PlayerState = {
  url: string | null
  position: number
  paused: boolean
}
