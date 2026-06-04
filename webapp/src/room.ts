import mqtt from 'mqtt'
import { BROKER_URL, PRESENCE_PING_MS, PRESENCE_TIMEOUT_MS } from './config'
import { deriveRoomCrypto, type RoomCrypto } from './crypto'
import type { Ctrl, UrlMsg } from './types'

export type PeerHandler = (peerId: string) => void

type Channel = 'ctrl' | 'url' | 'hello' | 'ack' | 'ping' | 'bye'
type Envelope = { ch: Channel; from: string; data?: unknown }

// Sync transport over a public MQTT broker. End-to-end encrypted; the broker
// is just an untrusted relay. Same public interface as the old WebRTC room so
// sync.ts / main.ts are unchanged.
export class SyncRoom {
  readonly roomId: string
  private clientId = crypto.randomUUID()
  private client: mqtt.MqttClient | null = null
  private rc: RoomCrypto | null = null
  private outbox: Envelope[] = []
  private peers = new Map<string, number>() // peerId -> lastSeen ms

  private ctrlHandler: ((m: Ctrl, p: string) => void) | null = null
  private urlHandler: ((m: UrlMsg, p: string) => void) | null = null
  private helloHandler: PeerHandler | null = null
  private joinHandler: PeerHandler | null = null
  private leaveHandler: PeerHandler | null = null

  constructor(roomId: string) {
    this.roomId = roomId
    void this.start(roomId)
  }

  private async start(code: string) {
    const rc = await deriveRoomCrypto(code)
    this.rc = rc

    const client = mqtt.connect(BROKER_URL, {
      clientId: 'seehub_' + this.clientId.slice(0, 8),
      clean: true,
      reconnectPeriod: 2000,
    })
    this.client = client

    client.on('connect', () => {
      client.subscribe(rc.topic, { qos: 0 })
      void this.publish({ ch: 'hello', from: this.clientId })
      // flush anything queued before connect
      const queued = this.outbox.splice(0)
      for (const env of queued) void this.publish(env)
    })

    client.on('message', (_topic, payload) => {
      void this.onMessage(payload.toString())
    })

    // presence ping + expiry sweep
    setInterval(() => {
      void this.publish({ ch: 'ping', from: this.clientId })
      const now = Date.now()
      for (const [id, last] of this.peers) {
        if (now - last > PRESENCE_TIMEOUT_MS) {
          this.peers.delete(id)
          this.leaveHandler?.(id)
        }
      }
    }, PRESENCE_PING_MS)
  }

  private async publish(env: Envelope) {
    if (!this.client || !this.rc || !this.client.connected) {
      this.outbox.push(env)
      return
    }
    const ciphertext = await this.rc.encrypt(env)
    this.client.publish(this.rc.topic, ciphertext, { qos: 0 })
  }

  private async onMessage(raw: string) {
    if (!this.rc) return
    const env = (await this.rc.decrypt(raw)) as Envelope | null
    if (!env || env.from === this.clientId) return // ignore foreign/own

    this.touchPeer(env.from)

    switch (env.ch) {
      case 'hello':
        // new (or reconnecting) peer announced itself → tell it we exist, and
        // let the engine push a fresh full state so it realigns immediately.
        void this.publish({ ch: 'ack', from: this.clientId })
        this.helloHandler?.(env.from)
        break
      case 'ack':
      case 'ping':
        break // presence only, handled by touchPeer
      case 'ctrl':
        this.ctrlHandler?.(env.data as Ctrl, env.from)
        break
      case 'url':
        this.urlHandler?.(env.data as UrlMsg, env.from)
        break
      case 'bye':
        if (this.peers.delete(env.from)) this.leaveHandler?.(env.from)
        break
    }
  }

  private touchPeer(id: string) {
    const known = this.peers.has(id)
    this.peers.set(id, Date.now())
    if (!known) this.joinHandler?.(id)
  }

  // --- public API (unchanged) ---

  sendCtrl(msg: Ctrl) {
    void this.publish({ ch: 'ctrl', from: this.clientId, data: msg })
  }

  sendUrl(msg: UrlMsg) {
    void this.publish({ ch: 'url', from: this.clientId, data: msg })
  }

  onCtrl(handler: (msg: Ctrl, peerId: string) => void) {
    this.ctrlHandler = handler
  }

  onUrl(handler: (msg: UrlMsg, peerId: string) => void) {
    this.urlHandler = handler
  }

  // Fires when a peer (re)announces itself via hello — used to re-share the URL.
  onHello(handler: PeerHandler) {
    this.helloHandler = handler
  }

  onPeerJoin(handler: PeerHandler) {
    this.joinHandler = handler
  }

  onPeerLeave(handler: PeerHandler) {
    this.leaveHandler = handler
  }

  peerCount(): number {
    return this.peers.size
  }

  myId(): string {
    return this.clientId
  }

  leave() {
    void this.publish({ ch: 'bye', from: this.clientId })
    this.client?.end()
  }
}
