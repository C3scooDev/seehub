// All sync traffic is end-to-end encrypted with a key derived from the room
// code, so the public broker only ever sees opaque ciphertext. The topic is
// derived from the same code (different salt) so the room is unguessable.

const enc = new TextEncoder()
const dec = new TextDecoder()

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(input))
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export type RoomCrypto = {
  topic: string
  encrypt: (obj: unknown) => Promise<string>
  decrypt: (payload: string) => Promise<unknown | null>
}

export async function deriveRoomCrypto(code: string): Promise<RoomCrypto> {
  const topic = 'seehub/v1/' + toHex(await sha256('seehub-topic:' + code)).slice(0, 32)
  const keyBytes = await sha256('seehub-key:' + code)
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])

  return {
    topic,
    async encrypt(obj: unknown): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        enc.encode(JSON.stringify(obj))
      )
      return toB64(iv) + '.' + toB64(ct)
    },
    async decrypt(payload: string): Promise<unknown | null> {
      try {
        const [ivB64, ctB64] = payload.split('.')
        if (!ivB64 || !ctB64) return null
        const pt = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: fromB64(ivB64) as BufferSource },
          key,
          fromB64(ctB64) as BufferSource
        )
        return JSON.parse(dec.decode(pt))
      } catch {
        return null // wrong key / corrupt / foreign message
      }
    },
  }
}
