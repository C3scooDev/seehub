import {
  HEARTBEAT_MS,
  HARD_SEEK_THRESHOLD,
  SOFT_DRIFT_THRESHOLD,
  RATE_NUDGE,
} from './config'
import type { Player } from './player'
import type { SyncRoom } from './room'
import type { Ctrl, EpisodeMsg } from './types'

// The vixcloud token is shareable across IPs but SINGLE-SESSION: two peers can't
// stream the SAME token at once (the second kills the first). So each peer must
// extract its OWN token from its OWN IP. The host shares only the EPISODE over
// the 'episode' channel; every peer resolves its own m3u8 and loads it. Controls
// (play/pause/seek) + a heartbeat keep playback in sync.

export type SyncEvents = {
  onPeersChanged: (count: number) => void
  // This peer must resolve its OWN m3u8 for `ep` (extension / Shortcut).
  onNeedSelfExtract: (ep: string) => void
  // This peer loaded its own stream and is in sync.
  onRemoteUrl: () => void
  // Playback dropped while offline — recovering when the network returns.
  onConnLost: () => void
  // Playback kept failing while online (token expired) — re-extract.
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
  // Next load is a fresh episode (load from start, not a token refresh).
  private nextLoadFresh = false
  // Episode this device is on: host shares it; peers extract from it.
  private currentEp: string | null = null
  // The m3u8 (own token) currently loaded here — for reload on recovery.
  private currentUrl: string | null = null
  // Consecutive fatal media failures while online — reset once healthy.
  private failCount = 0

  constructor(player: Player, room: SyncRoom, ev: SyncEvents) {
    this.player = player
    this.room = room
    this.ev = ev

    room.onCtrl((msg) => this.handleCtrl(msg))
    room.onEpisode((msg) => this.handleEpisode(msg))

    // When the network comes back, reload the (still valid) own stream.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.failCount = 0
        if (!this.localMediaLoaded && this.currentUrl) this.recoverMedia()
      })
    }

    room.onPeerJoin(() => {
      this.ev.onPeersChanged(room.peerCount())
      if (this.isHost) this.broadcastEpisode(false)
    })
    room.onPeerLeave(() => this.ev.onPeersChanged(room.peerCount()))

    // A peer (re)announcing itself — including after a reconnect — may be stale.
    // If we're the authority, re-share the episode + position so it extracts /
    // realigns immediately.
    room.onHello(() => {
      if (this.isHost) this.broadcastEpisode(false)
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

  // The HOST extracted its own m3u8 (from the extension). Load it locally and
  // share the EPISODE (not the URL) so every peer extracts its own token.
  userLoad(url: string, ep?: string) {
    const fresh = this.nextLoadFresh || !this.player.hasUrl
    this.nextLoadFresh = false
    this.loadLocally(url, fresh, this.pendingStart ?? undefined)
    this.currentUrl = url
    if (ep) this.currentEp = ep
    this.localMediaLoaded = true
    this.failCount = 0
    if (!this.sawRemoteAuthority) this.isHost = true
    this.broadcastEpisode(fresh)
  }

  // A PEER resolved its own m3u8 for the shared episode. Load it locally; do NOT
  // broadcast (each peer has its own token; position syncs via the heartbeat).
  loadOwnToken(url: string) {
    this.loadLocally(url, this.nextLoadFresh || !this.player.hasUrl, this.pendingStart ?? undefined)
    this.nextLoadFresh = false
    this.currentUrl = url
    this.localMediaLoaded = true
    this.failCount = 0
    this.isHost = false
    this.ev.onRemoteUrl()
  }

  // Host is about to extract a NEW episode → arm a from-the-start load.
  userChangeEpisode(ep: string) {
    this.isHost = true
    this.sawRemoteAuthority = false
    this.nextLoadFresh = true
    this.currentEp = ep
    this.pendingStart = { position: 0, paused: true }
  }

  notifyMediaFailed(_kind: 'network' | 'media') {
    this.localMediaLoaded = false
    if (!this.currentUrl && !this.currentEp) return this.ev.onMediaFailed()
    // Offline → wait for the 'online' event / host re-share (navigator.onLine
    // lies on mobile hotspots, so we still retry below if it claims online).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.ev.onConnLost()
      return
    }
    this.failCount++
    // A few quick reloads of our own token (transient). If it keeps failing the
    // token likely expired → re-extract a fresh one. Never strand permanently.
    if (this.failCount <= 3 && this.currentUrl) {
      this.ev.onConnLost()
      const delay = Math.min(1000 * this.failCount, 5000)
      window.setTimeout(() => {
        if (!this.localMediaLoaded) this.recoverMedia()
      }, delay)
    } else if (this.currentEp) {
      this.ev.onMediaFailed()
      this.ev.onNeedSelfExtract(this.currentEp) // get a brand-new token
    } else {
      this.ev.onMediaFailed()
    }
  }

  private recoverMedia() {
    if (!this.currentUrl) return
    this.loadLocally(this.currentUrl, false, this.pendingStart ?? { position: 0, paused: true })
    this.localMediaLoaded = true
    this.ev.onRemoteUrl()
  }

  private loadLocally(url: string, fresh: boolean, start?: { position: number; paused: boolean }) {
    if (!fresh && this.player.hasUrl) {
      this.player.swapUrl(url, start?.position)
    } else {
      this.player.loadUrl(url, start?.position ?? 0, start?.paused ?? true)
    }
  }

  private broadcastEpisode(fresh: boolean) {
    if (!this.currentEp) return
    const s = this.player.getState()
    this.room.sendEpisode({
      ep: this.currentEp,
      fresh,
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

  private handleEpisode(msg: EpisodeMsg) {
    this.sawRemoteAuthority = true
    this.isHost = false
    this.pendingStart = { position: msg.position, paused: msg.paused }

    const episodeChanged = msg.ep !== this.currentEp
    if (msg.fresh || episodeChanged) {
      // New episode → (re)extract our own token from the start.
      this.currentEp = msg.ep
      this.nextLoadFresh = true
      this.localMediaLoaded = false
      this.currentUrl = null
      this.ev.onNeedSelfExtract(msg.ep)
    } else if (!this.localMediaLoaded && !this.currentUrl) {
      // Same episode resync but we never extracted yet (late/returning peer).
      this.currentEp = msg.ep
      this.ev.onNeedSelfExtract(msg.ep)
    }
    // else: same episode, already have our own token → heartbeat realigns us.
  }

  private applyDrift(hb: Extract<Ctrl, { type: 'heartbeat' }>) {
    const s = this.player.getState()
    if (!s.url) return
    this.failCount = 0 // applying heartbeats = healthy again
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
