import {
  HEARTBEAT_MS,
  HARD_SEEK_THRESHOLD,
  SOFT_DRIFT_THRESHOLD,
  RATE_NUDGE,
} from './config'
import type { Player } from './player'
import type { SyncRoom } from './room'
import type { Ctrl, UrlMsg } from './types'

// Vixcloud tokens turned out to be shareable across IPs (verified empirically),
// so the host extracts ONCE and shares its m3u8 over the 'url' channel; every
// peer loads that exact URL — no per-peer extraction, no extension for guests.
// Controls (play/pause/seek) and a heartbeat keep playback in sync.

export type SyncEvents = {
  onPeersChanged: (count: number) => void
  // A peer received and loaded the host's shared stream (hide setup UI).
  onRemoteUrl: () => void
  // Local playback failed (e.g. token expired). Host should re-extract.
  onMediaFailed: () => void
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
  // Next userLoad() is a fresh episode (load from start, not a token refresh
  // that would preserve the current position).
  private nextLoadFresh = false
  // URL currently loaded here — to skip needless reloads when the host re-sends
  // the same stream on a join/hello resync.
  private currentUrl: string | null = null

  constructor(player: Player, room: SyncRoom, ev: SyncEvents) {
    this.player = player
    this.room = room
    this.ev = ev

    room.onCtrl((msg) => this.handleCtrl(msg))
    room.onUrl((msg, peerId) => this.handleUrl(msg, peerId))

    room.onPeerJoin(() => {
      this.ev.onPeersChanged(room.peerCount())
      if (this.isHost) this.broadcastCurrentUrl(false)
    })
    room.onPeerLeave(() => this.ev.onPeersChanged(room.peerCount()))

    // A peer (re)announcing itself — including after a dropped MQTT connection
    // that reconnected — means it may be stale. If we're the authority, re-share
    // the URL + current position so it loads/realigns immediately.
    room.onHello(() => {
      if (this.isHost) this.broadcastCurrentUrl(false)
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

  // The host loaded an m3u8 (from the extension or a manual paste). Load it
  // locally and share it so every peer loads the same stream.
  userLoad(url: string) {
    const fresh = this.nextLoadFresh || !this.player.hasUrl
    this.nextLoadFresh = false
    this.loadLocally(url, fresh, this.pendingStart ?? undefined)
    this.currentUrl = url
    this.localMediaLoaded = true
    if (!this.sawRemoteAuthority) this.isHost = true
    this.broadcastCurrentUrl(fresh)
  }

  // Host is about to extract a NEW episode → arm a from-the-start load and
  // reclaim authority. The subsequent userLoad() shares the new URL.
  userChangeEpisode(_ep: string) {
    this.isHost = true
    this.sawRemoteAuthority = false
    this.nextLoadFresh = true
    this.pendingStart = { position: 0, paused: true }
  }

  // Player reported a fatal error (network drop, or token expired). The token
  // is shareable and valid ~6h, so a transient failure usually just needs a
  // reload of the same stream — the host's heartbeat then realigns the
  // position. Retry locally (throttled); only give up if it keeps failing.
  private mediaRetryAt = 0
  notifyMediaFailed(_kind: 'network' | 'media') {
    this.localMediaLoaded = false
    const now = Date.now()
    if (this.currentUrl && now - this.mediaRetryAt > 8000) {
      this.mediaRetryAt = now
      this.loadLocally(this.currentUrl, false, this.pendingStart ?? { position: 0, paused: true })
      this.localMediaLoaded = true
      this.ev.onRemoteUrl()
    } else {
      this.ev.onMediaFailed()
    }
  }

  private loadLocally(url: string, fresh: boolean, start?: { position: number; paused: boolean }) {
    if (!fresh && this.player.hasUrl) {
      this.player.swapUrl(url, start?.position)
    } else {
      this.player.loadUrl(url, start?.position ?? 0, start?.paused ?? true)
    }
  }

  private broadcastCurrentUrl(fresh: boolean) {
    if (!this.currentUrl) return
    const s = this.player.getState()
    this.room.sendUrl({ url: this.currentUrl, fresh, position: s.position, paused: s.paused })
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

  private handleUrl(msg: UrlMsg, peerId: string) {
    // If we both extracted near-simultaneously, lower clientId stays host and
    // keeps its own stream (both tokens are valid — shareable).
    if (this.isHost && this.localMediaLoaded && this.room.myId() < peerId) return

    this.sawRemoteAuthority = true
    this.isHost = false

    // Same stream re-shared on a join/hello resync AND our media is alive →
    // just realign, no reload. If our media died (network drop killed the
    // player), fall through and reload even though the URL is unchanged.
    if (msg.url === this.currentUrl && !msg.fresh && this.localMediaLoaded && this.player.hasUrl) {
      if (msg.paused) this.player.remotePause(msg.position)
      else this.player.remotePlay(msg.position)
      return
    }

    // New stream (or recovering dead media) → load it at the host's position.
    this.currentUrl = msg.url
    this.pendingStart = { position: msg.position, paused: msg.paused }
    this.loadLocally(msg.url, msg.fresh, { position: msg.position, paused: msg.paused })
    this.localMediaLoaded = true
    this.ev.onRemoteUrl()
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
