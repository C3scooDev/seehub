export type Ctrl =
  | { type: 'play'; position: number; sentAt: number }
  | { type: 'pause'; position: number; sentAt: number }
  | { type: 'seek'; position: number; sentAt: number }
  | { type: 'heartbeat'; position: number; paused: boolean; sentAt: number }

// The vixcloud token is SINGLE-SESSION, so the host shares only the episode and
// each peer extracts its own token. `fresh` = new episode (extract from start);
// otherwise a resync (extract only if we have no token yet; else just realign).
export type EpisodeMsg = {
  ep: string
  fresh: boolean
  position: number
  paused: boolean
  sentAt: number
}

export type PlayerState = {
  url: string | null
  position: number
  paused: boolean
}
