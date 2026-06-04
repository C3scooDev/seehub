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

// 2. Per-peer model: each peer loads its OWN m3u8 (tokens are IP-bound). Here
// both are on the same IP, so the same test URL works for both.
const videoReady = (page) =>
  page.waitForFunction(
    () => {
      const v = document.getElementById('video')
      return v && v.readyState >= 1
    },
    { timeout: 60000 }
  )

await host.fill('#m3u8-input', TEST_M3U8)
await host.click('#load-m3u8')
await videoReady(host).catch(() => fail('host did not load its video'))

await guest.fill('#m3u8-input', TEST_M3U8)
await guest.click('#load-m3u8')
await videoReady(guest).catch(() => fail('guest did not load its video'))
console.log('✓ both peers loaded their own m3u8')

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

// 8. Host changes episode → guest is told (episode channel) to re-extract its
// OWN m3u8 and is shown the extract panel. (Actual extraction needs the
// extension, absent here — we assert the prompt/propagation only.)
const NEW_EP = 'https://streamingcommunityz.design/it/watch/1955?e=82376'
await host.fill('#episode-input', NEW_EP)
await host.click('#episode-load')
await guest
  .waitForFunction(
    (ep) => {
      const panel = document.getElementById('extract-panel')
      const input = document.getElementById('episode-input')
      return panel && !panel.classList.contains('hidden') && input && input.value === ep
    },
    NEW_EP,
    { timeout: 15000 }
  )
  .catch(() => fail('guest not prompted to re-extract after host episode change'))
console.log('✓ episode change propagated host → guest')

// 9. Reconnect realign: guest reloads (fresh MQTT connect → hello). The host
// (still the authority) must push full state on hello so the returning guest
// jumps to the host position, not back to 0, after reloading its own m3u8.
await guest.reload()
await guest.waitForSelector('#status.connected', { timeout: 30000 }).catch(() => fail('guest did not reconnect'))
await guest.fill('#m3u8-input', TEST_M3U8)
await guest.click('#load-m3u8')
await videoReady(guest).catch(() => fail('returning guest did not reload its video'))
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
