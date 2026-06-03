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

export type PlayerState = {
  url: string | null
  position: number
  paused: boolean
}
