// Two-peer sync smoke test: host + guest in separate browser contexts.
// Uses public nostr relays for signaling and a public test HLS stream.
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5173/'
const TEST_M3U8 = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
const ROOM = 'e2e' + Math.random().toString(36).slice(2, 8)

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exit(1)
}

const browser = await chromium.launch()
const hostCtx = await browser.newContext()
const guestCtx = await browser.newContext()
const host = await hostCtx.newPage()
const guest = await guestCtx.newPage()

const interesting = (t) => t.includes('[sync]') || t.includes('[player]')
host.on('console', (m) => (m.type() === 'error' || interesting(m.text())) && console.log('[host]', m.text()))
guest.on('console', (m) => (m.type() === 'error' || interesting(m.text())) && console.log('[guest]', m.text()))

console.log('room:', ROOM)
await host.goto(`${BASE}?room=${ROOM}`)
await guest.goto(`${BASE}?room=${ROOM}`)

// 1. Peer connection via nostr signaling
console.log('waiting for peer connection...')
await host.waitForSelector('#status.connected', { timeout: 90000 }).catch(() => fail('host never connected'))
await guest.waitForSelector('#status.connected', { timeout: 30000 }).catch(() => fail('guest never connected'))
console.log('✓ peers connected')

// 2. Shared-URL model: only the HOST loads an m3u8; the guest must receive it
// over the room and load it automatically (vixcloud tokens are shareable).
const videoReady = (page) =>
  page.waitForFunction(
    () => {
      const v = document.getElementById('video')
      return v && v.readyState >= 1
    },
    { timeout: 60000 }
  )

await host.evaluate(() => {
  const d = document.querySelector('details')
  if (d) d.open = true
})
await host.fill('#m3u8-input', TEST_M3U8)
await host.click('#load-m3u8')
await videoReady(host).catch(() => fail('host did not load its video'))

// Guest pastes nothing — the host's URL is shared automatically.
await videoReady(guest).catch(() => fail('guest did not auto-receive the host stream'))
console.log('✓ host loaded; guest auto-received the shared URL')

// 3. Host plays → guest plays
await host.evaluate(() => document.getElementById('video').play().catch(() => {}))
await guest.waitForFunction(() => !document.getElementById('video').paused, { timeout: 15000 })
  .catch(() => fail('guest did not start playing after host play'))
console.log('✓ play propagated host → guest')

// 4. Host seeks → guest follows
await host.evaluate(() => { document.getElementById('video').currentTime = 60 })
await guest.waitForFunction(() => Math.abs(document.getElementById('video').currentTime - 60) < 5, { timeout: 15000 })
  .catch(() => fail('guest did not follow host seek to 60s'))
console.log('✓ seek propagated host → guest')

// 5. Guest pauses → host pauses (shared pause, both directions)
await guest.evaluate(() => document.getElementById('video').pause())
await host.waitForFunction(() => document.getElementById('video').paused, { timeout: 15000 })
  .catch(() => fail('host did not pause after guest pause'))
console.log('✓ pause propagated guest → host')

// 6. Guest resumes → host resumes
await guest.evaluate(() => document.getElementById('video').play().catch(() => {}))
await host.waitForFunction(() => !document.getElementById('video').paused, { timeout: 15000 })
  .catch(() => fail('host did not resume after guest play'))
console.log('✓ play propagated guest → host')

// 7. No echo oscillation: state stays stable past the heartbeat grace window
// (guest ignores heartbeats for ~5.5s after its user action), then drift-corrects.
await host.waitForTimeout(14000)
const hostPaused = await host.evaluate(() => document.getElementById('video').paused)
const guestPaused = await guest.evaluate(() => document.getElementById('video').paused)
if (hostPaused || guestPaused) fail(`echo oscillation: hostPaused=${hostPaused} guestPaused=${guestPaused}`)
const [hp, gp] = await Promise.all([
  host.evaluate(() => document.getElementById('video').currentTime),
  guest.evaluate(() => document.getElementById('video').currentTime),
])
console.log(`✓ stable after heartbeat — positions host=${hp.toFixed(1)}s guest=${gp.toFixed(1)}s drift=${Math.abs(hp - gp).toFixed(2)}s`)
if (Math.abs(hp - gp) > 3) fail('drift too large')

// 8. Reconnect realign: guest reloads (fresh MQTT connect → hello). The host
// re-shares its URL + position on hello, so the returning guest auto-loads the
// stream again — NO manual paste — and jumps to the host position, not 0.
await guest.reload()
await guest.waitForSelector('#status.connected', { timeout: 30000 }).catch(() => fail('guest did not reconnect'))
await videoReady(guest).catch(() => fail('returning guest did not auto-receive the shared URL'))
await guest
  .waitForFunction(() => document.getElementById('video').currentTime > 5, { timeout: 20000 })
  .catch(() => fail('returning guest did not realign to host position (stuck near 0)'))
const [hp2, gp2] = await Promise.all([
  host.evaluate(() => document.getElementById('video').currentTime),
  guest.evaluate(() => document.getElementById('video').currentTime),
])
console.log(`✓ reconnect realign — host=${hp2.toFixed(1)}s guest=${gp2.toFixed(1)}s drift=${Math.abs(hp2 - gp2).toFixed(2)}s`)
if (Math.abs(hp2 - gp2) > 5) fail('reconnect realign drift too large')

console.log('ALL PASS')
await browser.close()
process.exit(0)
