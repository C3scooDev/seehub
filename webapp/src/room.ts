import { joinRoom, APP_ID, RTC_CONFIG } from './config'
import type { Ctrl, StateMsg, UrlMsg } from './types'

export type PeerHandler = (peerId: string) => void

// Thin typed wrapper around the trystero room and its action channels.
export class SyncRoom {
  readonly roomId: string
  private room: ReturnType<typeof joinRoom>
  private ctrl
  private state
  private url

  constructor(roomId: string) {
    this.roomId = roomId
    this.room = joinRoom({ appId: APP_ID, rtcConfig: RTC_CONFIG }, roomId)

    // Action names must be ≤12 bytes.
    this.ctrl = this.room.makeAction<Ctrl>('ctrl')
    this.state = this.room.makeAction<StateMsg>('state')
    this.url = this.room.makeAction<UrlMsg>('url')
  }

  sendCtrl(msg: Ctrl) {
    void this.ctrl.send(msg)
  }

  sendState(msg: StateMsg) {
    void this.state.send(msg)
  }

  sendUrl(msg: UrlMsg) {
    void this.url.send(msg)
  }

  onCtrl(handler: (msg: Ctrl, peerId: string) => void) {
    this.ctrl.onMessage = (data, ctx) => handler(data, ctx.peerId)
  }

  onState(handler: (msg: StateMsg, peerId: string) => void) {
    this.state.onMessage = (data, ctx) => handler(data, ctx.peerId)
  }

  onUrl(handler: (msg: UrlMsg, peerId: string) => void) {
    this.url.onMessage = (data, ctx) => handler(data, ctx.peerId)
  }

  onPeerJoin(handler: PeerHandler) {
    this.room.onPeerJoin = handler
  }

  onPeerLeave(handler: PeerHandler) {
    this.room.onPeerLeave = handler
  }

  peerCount(): number {
    return Object.keys(this.room.getPeers()).length
  }

  leave() {
    void this.room.leave()
  }
}
