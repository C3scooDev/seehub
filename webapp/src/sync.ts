import {
  HEARTBEAT_MS,
  HARD_SEEK_THRESHOLD,
  SOFT_DRIFT_THRESHOLD,
  RATE_NUDGE,
} from './config'
import type { Player } from './player'
import type { SyncRoom } from './room'
import type { Ctrl, StateMsg, UrlMsg } from './types'

export type SyncEvents = {
  onPeersChanged: (count: number) => void
  onRemoteUrl: (url: string) => void
}

// Coordinates player <-> room. The peer that loads a URL locally becomes
// host: it heartbeats and is the resync authority; the guest drift-corrects.
// After a local user action, ignore incoming heartbeats briefly: the host's
// state is stale until our ctrl message reaches it and its next heartbeat
// reflects it. Without this, host's old "paused" heartbeat re-pauses a guest
// that just resumed.
const HEARTBEAT_GRACE_MS = HEARTBEAT_MS + 1500

export class SyncEngine {
  isHost = false
  private player: Player
  private room: SyncRoom
  private ev: SyncEvents
  private lastUserActionAt = 0

  constructor(player: Player, room: SyncRoom, ev: SyncEvents) {
    this.player = player
    this.room = room
    this.ev = ev

    room.onCtrl((msg) => {
      console.debug('[sync] recv ctrl', msg.type, msg.position.toFixed(1))
      this.handleCtrl(msg)
    })
    room.onState((msg) => this.handleState(msg))
    room.onUrl((msg) => this.handleUrl(msg))

    room.onPeerJoin(() => {
      this.ev.onPeersChanged(room.peerCount())
      if (this.isHost && this.player.hasUrl) this.sendFullState()
    })
    room.onPeerLeave(() => this.ev.onPeersChanged(room.peerCount()))

    setInterval(() => {
      if (this.isHost && this.player.hasUrl) {
        const s = this.player.getState()
        this.room.sendCtrl({
          type: 'heartbeat',
          position: s.position,
          paused: s.paused,
          sentAt: Date.now(),
        })
      }
    }, HEARTBEAT_MS)
  }

  // --- outgoing: user-originated player events ---

  userPlay(position: number) {
    console.debug('[sync] send play', position.toFixed(1))
    this.lastUserActionAt = Date.now()
    this.room.sendCtrl({ type: 'play', position, sentAt: Date.now() })
  }

  userPause(position: number) {
    console.debug('[sync] send pause', position.toFixed(1))
    this.lastUserActionAt = Date.now()
    this.room.sendCtrl({ type: 'pause', position, sentAt: Date.now() })
  }

  userSeek(position: number) {
    console.debug('[sync] send seek', position.toFixed(1))
    this.lastUserActionAt = Date.now()
    this.room.sendCtrl({ type: 'seek', position, sentAt: Date.now() })
  }

  // Host loads a URL locally and broadcasts it.
  loadAsHost(url: string, reason: UrlMsg['reason'] = 'load') {
    this.isHost = true
    if (reason === 'token-refresh') {
      const pos = this.player.getState().position
      this.player.swapUrl(url)
      this.room.sendUrl({ url, position: pos, reason })
    } else {
      this.player.loadUrl(url)
      this.room.sendUrl({ url, reason })
    }
  }

  private sendFullState() {
    const s = this.player.getState()
    if (!s.url) return
    this.room.sendState({
      url: s.url,
      position: s.position,
      paused: s.paused,
      sentAt: Date.now(),
    })
  }

  // --- incoming ---

  private handleCtrl(msg: Ctrl) {
    switch (msg.type) {
      case 'play':
        this.player.remotePlay(msg.position)
        break
      case 'pause':
        this.player.remotePause(msg.position)
        break
      case 'seek':
        this.player.remoteSeek(msg.position)
        break
      case 'heartbeat':
        if (!this.isHost) this.applyDrift(msg)
        break
    }
  }

  private handleState(msg: StateMsg) {
    if (this.isHost) return
    const s = this.player.getState()
    if (s.url !== msg.url) {
      this.ev.onRemoteUrl(msg.url)
      this.player.loadUrl(msg.url, msg.position, msg.paused)
    } else {
      if (msg.paused) this.player.remotePause(msg.position)
      else this.player.remotePlay(msg.position)
    }
  }

  private handleUrl(msg: UrlMsg) {
    this.isHost = false
    this.ev.onRemoteUrl(msg.url)
    if (msg.reason === 'token-refresh') {
      this.player.swapUrl(msg.url, msg.position)
    } else {
      this.player.loadUrl(msg.url, msg.position ?? 0)
    }
  }

  private applyDrift(hb: Extract<Ctrl, { type: 'heartbeat' }>) {
    const s = this.player.getState()
    if (!s.url) return
    if (Date.now() - this.lastUserActionAt < HEARTBEAT_GRACE_MS) return

    if (hb.paused !== s.paused) {
      if (hb.paused) this.player.remotePause(hb.position)
      else this.player.remotePlay(hb.position)
      return
    }
    if (hb.paused) return

    const delta = hb.position - s.position
    if (Math.abs(delta) > HARD_SEEK_THRESHOLD) {
      this.player.remoteSeek(hb.position)
      this.player.setRate(1)
    } else if (Math.abs(delta) > SOFT_DRIFT_THRESHOLD) {
      this.player.setRate(delta > 0 ? 1 + RATE_NUDGE : 1 - RATE_NUDGE)
    } else {
      this.player.setRate(1)
    }
  }
}
