import {
  HEARTBEAT_MS,
  HARD_SEEK_THRESHOLD,
  SOFT_DRIFT_THRESHOLD,
  RATE_NUDGE,
} from './config'
import type { Player } from './player'
import type { SyncRoom } from './room'
import type { Ctrl, StateMsg, UrlMsg, EpisodeMsg } from './types'

// Vixcloud tokens are bound to the extractor's IP, so peers on different
// networks CANNOT share one m3u8 URL — each must extract and load its OWN.
// Therefore the URL is never force-loaded across peers: we only sync controls
// (play/pause/seek) and position. The "url" message is just a host-active
// claim that tells the other peer to extract and paste its own link.

export type NeedUrlReason = 'host-started' | 'forbidden' | 'error'

export type SyncEvents = {
  onPeersChanged: (count: number) => void
  onNeedLocalUrl: (reason: NeedUrlReason) => void
  // Host switched episode → this peer must re-extract its own m3u8 for `ep`.
  onRemoteEpisode: (ep: string) => void
}

// After a local user action, ignore incoming heartbeats briefly: the host's
// state is stale until our ctrl reaches it and its next heartbeat reflects it.
const HEARTBEAT_GRACE_MS = HEARTBEAT_MS + 1500

export class SyncEngine {
  isHost = false
  private player: Player
  private room: SyncRoom
  private ev: SyncEvents
  private lastUserActionAt = 0

  private localMediaLoaded = false
  private sawRemoteAuthority = false
  // Latest host position while we have no local media yet → jump here on load.
  private pendingStart: { position: number; paused: boolean } | null = null
  // Next userLoad() is a fresh episode (load from pendingStart, not a token
  // refresh that would preserve the current position).
  private nextLoadFresh = false

  constructor(player: Player, room: SyncRoom, ev: SyncEvents) {
    this.player = player
    this.room = room
    this.ev = ev

    room.onCtrl((msg) => this.handleCtrl(msg))
    room.onState((msg) => this.handleState(msg))
    room.onUrl((msg, peerId) => this.handleUrl(msg, peerId))
    room.onEpisode((msg) => this.handleEpisode(msg))

    room.onPeerJoin(() => {
      this.ev.onPeersChanged(room.peerCount())
      if (this.isHost && this.player.hasUrl) this.sendFullState()
    })
    room.onPeerLeave(() => this.ev.onPeersChanged(room.peerCount()))

    // A peer (re)announcing itself — including after a dropped MQTT connection
    // that reconnected — means it may be stale. If we're the authority, push a
    // fresh full state so it realigns immediately instead of waiting a heartbeat.
    room.onHello(() => {
      if (this.isHost && this.player.hasUrl) this.sendFullState()
    })

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
    this.lastUserActionAt = Date.now()
    this.room.sendCtrl({ type: 'play', position, sentAt: Date.now() })
  }

  userPause(position: number) {
    this.lastUserActionAt = Date.now()
    this.room.sendCtrl({ type: 'pause', position, sentAt: Date.now() })
  }

  userSeek(position: number) {
    this.lastUserActionAt = Date.now()
    this.room.sendCtrl({ type: 'seek', position, sentAt: Date.now() })
  }

  // User pasted an m3u8 (their own). Loads locally; broadcasts a host-claim
  // only if no other peer is already the authority.
  userLoad(url: string) {
    const fresh = this.nextLoadFresh
    this.nextLoadFresh = false
    // Token refresh of the SAME stream preserves the current position; a fresh
    // episode (or first load) starts from pendingStart (host's position, or 0).
    if (!fresh && this.player.hasUrl) {
      this.player.swapUrl(url)
    } else {
      const start = this.pendingStart
      this.player.loadUrl(url, start?.position ?? 0, start?.paused ?? true)
    }
    this.localMediaLoaded = true

    if (!this.sawRemoteAuthority) {
      this.isHost = true
      this.room.sendUrl({ url, reason: fresh ? 'load' : 'token-refresh' })
    }
  }

  // Host picked a new episode. Broadcast it so the other peer re-extracts its
  // own m3u8, and arm a fresh load (from the start) for our own re-extraction.
  userChangeEpisode(ep: string) {
    this.isHost = true
    this.sawRemoteAuthority = false
    this.nextLoadFresh = true
    this.pendingStart = { position: 0, paused: true }
    this.room.sendEpisode({ ep, sentAt: Date.now() })
  }

  // Player reported a fatal load error (403 token = IP-bound, or media error).
  notifyMediaFailed(kind: 'network' | 'media') {
    this.localMediaLoaded = false
    this.ev.onNeedLocalUrl(kind === 'network' ? 'forbidden' : 'error')
  }

  private sendFullState() {
    const s = this.player.getState()
    this.room.sendState({
      url: '', // not used by peers (IP-bound); kept for wire shape
      position: s.position,
      paused: s.paused,
      sentAt: Date.now(),
    })
  }

  // --- incoming ---

  private handleCtrl(msg: Ctrl) {
    switch (msg.type) {
      case 'play':
        if (this.localMediaLoaded) this.player.remotePlay(msg.position)
        else this.pendingStart = { position: msg.position, paused: false }
        break
      case 'pause':
        if (this.localMediaLoaded) this.player.remotePause(msg.position)
        else this.pendingStart = { position: msg.position, paused: true }
        break
      case 'seek':
        if (this.localMediaLoaded) this.player.remoteSeek(msg.position)
        else if (this.pendingStart) this.pendingStart.position = msg.position
        break
      case 'heartbeat':
        if (this.isHost) break
        if (this.localMediaLoaded) this.applyDrift(msg)
        else this.pendingStart = { position: msg.position, paused: msg.paused }
        break
    }
  }

  private handleState(msg: StateMsg) {
    this.sawRemoteAuthority = true
    this.isHost = false
    if (this.localMediaLoaded) {
      if (msg.paused) this.player.remotePause(msg.position)
      else this.player.remotePlay(msg.position)
    } else {
      this.pendingStart = { position: msg.position, paused: msg.paused }
      this.ev.onNeedLocalUrl('host-started')
    }
  }

  private handleEpisode(msg: EpisodeMsg) {
    // The other peer became authority for a new episode. Drop our old media,
    // arm a fresh load, and ask the UI to re-extract our own m3u8 for `ep`.
    this.sawRemoteAuthority = true
    this.isHost = false
    this.localMediaLoaded = false
    this.nextLoadFresh = true
    this.pendingStart = { position: 0, paused: true }
    this.ev.onRemoteEpisode(msg.ep)
  }

  private handleUrl(_msg: UrlMsg, peerId: string) {
    // Both peers may claim host if they loaded near-simultaneously. Deterministic
    // tie-break: lower clientId stays host.
    if (this.isHost && this.localMediaLoaded) {
      if (this.room.myId() < peerId) return // I keep host; ignore their claim
    }
    this.sawRemoteAuthority = true
    this.isHost = false
    if (!this.localMediaLoaded) this.ev.onNeedLocalUrl('host-started')
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
