import Hls from 'hls.js'
import { SEEK_DEDUPE } from './config'
import type { PlayerState } from './types'

// A remote-applied mutation sets an expectation that is consumed by the one
// native event it triggers (no echo). TTL guards against leaked expectations
// (e.g. play() rejected by autoplay policy) swallowing later real user events.
const EXPECT_TTL_MS = 1500

export type PlayerCallbacks = {
  onUserPlay: (position: number) => void
  onUserPause: (position: number) => void
  onUserSeek: (position: number) => void
  onFatalError: (kind: 'network' | 'media') => void
}

// hls.js wrapper. Distinguishes user-initiated events (forwarded to callbacks)
// from remote-applied mutations (squelched, no echo).
export class Player {
  private video: HTMLVideoElement
  private hls: Hls | null = null
  private cb: PlayerCallbacks
  private url: string | null = null
  private expect = { play: 0, pause: 0, seek: 0 } // timestamp of pending remote mutation, 0 = none
  private mediaRecovered = false

  constructor(video: HTMLVideoElement, cb: PlayerCallbacks) {
    this.video = video
    this.cb = cb

    video.addEventListener('play', () => {
      if (this.consume('play')) {
        console.debug('[player] play event consumed (remote)')
        return
      }
      this.cb.onUserPlay(video.currentTime)
    })
    video.addEventListener('pause', () => {
      if (video.ended) return
      if (this.consume('pause')) {
        console.debug('[player] pause event consumed (remote)')
        return
      }
      this.cb.onUserPause(video.currentTime)
    })
    video.addEventListener('seeking', () => {
      if (this.consume('seek')) return
      this.cb.onUserSeek(video.currentTime)
    })
  }

  // True if a fresh remote-mutation expectation was pending; consumes it.
  private consume(kind: 'play' | 'pause' | 'seek'): boolean {
    const ts = this.expect[kind]
    this.expect[kind] = 0
    return ts !== 0 && Date.now() - ts < EXPECT_TTL_MS
  }

  get hasUrl(): boolean {
    return this.url !== null
  }

  getState(): PlayerState {
    return {
      url: this.url,
      position: this.video.currentTime,
      paused: this.video.paused,
    }
  }

  loadUrl(url: string, startPos = 0, paused = true) {
    this.url = url
    this.destroyHls()
    this.video.style.display = 'block'

    if (Hls.isSupported()) {
      this.hls = new Hls()
      this.hls.loadSource(url)
      this.hls.attachMedia(this.video)
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.applyStart(startPos, paused)
      })
      this.hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !this.mediaRecovered) {
          this.mediaRecovered = true
          this.hls?.recoverMediaError()
          return
        }
        this.destroyHls()
        this.url = null
        this.cb.onFatalError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media')
      })
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      this.video.src = url
      this.video.addEventListener('loadedmetadata', () => this.applyStart(startPos, paused), {
        once: true,
      })
    }
  }

  private applyStart(startPos: number, paused: boolean) {
    if (startPos > 0) this.remoteSeek(startPos)
    if (!paused) this.remotePlay(startPos)
  }

  // Reload (fresh token) preserving position/paused state.
  swapUrl(url: string, position?: number) {
    const state = this.getState()
    this.loadUrl(url, position ?? state.position, state.paused)
  }

  // --- remote-applied mutations (squelched) ---

  remotePlay(position: number) {
    this.alignPosition(position)
    if (this.video.paused) {
      this.expect.play = Date.now()
      void this.video.play().catch((err) => {
        // Autoplay blocked: user must click play once; sync recovers via heartbeat.
        this.expect.play = 0
        console.debug('[player] remote play() rejected:', err?.name)
      })
    }
  }

  remotePause(position: number) {
    if (!this.video.paused) {
      this.expect.pause = Date.now()
      this.video.pause()
    }
    this.alignPosition(position)
  }

  remoteSeek(position: number) {
    this.alignPosition(position)
  }

  private alignPosition(position: number) {
    if (Math.abs(this.video.currentTime - position) <= SEEK_DEDUPE) return
    this.expect.seek = Date.now()
    this.video.currentTime = position
  }

  setRate(rate: number) {
    if (this.video.playbackRate !== rate) this.video.playbackRate = rate
  }

  private destroyHls() {
    this.mediaRecovered = false
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
  }
}
