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

// 2. Per-peer model: the host shares the EPISODE; each peer extracts its OWN
// token (single-session). The browser extension is absent here, so we simulate
// it by posting the SEEHUB_M3U8 message it would post (same public test stream
// for both — distinct tokens in reality). Only times sync after that.
const EP = 'https://streamingcommunityz.design/it/watch/1955?e=82376'
const videoReady = (page) =>
  page.waitForFunction(
    () => {
      const v = document.getElementById('video')
      return v && v.readyState >= 1
    },
    { timeout: 60000 }
  )
const deliverToken = (page) =>
  page.evaluate((u) => window.postMessage({ type: 'SEEHUB_M3U8', url: u }, location.origin), TEST_M3U8)

// Host enters the episode (→ resolveMode=host), extension "delivers" its token.
await host.fill('#episode-input', EP)
await host.click('#episode-load')
await deliverToken(host)
await videoReady(host).catch(() => fail('host did not load its own token'))

// Guest is prompted to self-extract (host shared the episode); simulate its
// extension delivering a SEPARATE token.
await guest
  .waitForSelector('#extract-panel:not(.hidden)', { timeout: 15000 })
  .catch(() => fail('guest was not asked to self-extract'))
await deliverToken(guest)
await videoReady(guest).catch(() => fail('guest did not load its own token'))
console.log('✓ host + guest each loaded their OWN token (episode shared, no conflict)')

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
// re-shares the EPISODE on hello, the returning guest re-extracts its own token
// (simulated) and jumps to the host position, not 0.
await guest.reload()
await guest.waitForSelector('#status.connected', { timeout: 30000 }).catch(() => fail('guest did not reconnect'))
await guest
  .waitForSelector('#extract-panel:not(.hidden)', { timeout: 20000 })
  .catch(() => fail('returning guest was not asked to re-extract'))
await deliverToken(guest)
await videoReady(guest).catch(() => fail('returning guest did not reload its own token'))
await guest
  .waitForFunction(() => document.getElementById('video').currentTime > 5, { timeout: 20000 })
  .catch(() => fail('returning guest did not realign to host position (stuck near 0)'))
const [hp2, gp2] = await Promise.all([
  host.evaluate(() => document.getElementById('video').currentTime),
  guest.evaluate(() => document.getElementById('video').currentTime),
])
console.log(`✓ reconnect realign — host=${hp2.toFixed(1)}s guest=${gp2.toFixed(1)}s drift=${Math.abs(hp2 - gp2).toFixed(2)}s`)
if (Math.abs(hp2 - gp2) > 5) fail('reconnect realign drift too large')

// 9. Network glitch (NO page reload): guest goes offline mid-playback, host
// keeps going, guest comes back. Must NOT reset the host to 0 (stale ctrl is
// dropped while offline) and must recover/realign instead of dying.
await Promise.all([
  host.evaluate(() => document.getElementById('video').play().catch(() => {})),
  guest.evaluate(() => document.getElementById('video').play().catch(() => {})),
])
const hostBefore = await host.evaluate(() => document.getElementById('video').currentTime)
await guestCtx.setOffline(true)
await guest.waitForTimeout(12000) // long outage: must NOT give up while offline
await guestCtx.setOffline(false)
// host must not have been yanked back near 0 by a stale "seek 0"
await host.waitForTimeout(4000)
const hostAfter = await host.evaluate(() => document.getElementById('video').currentTime)
if (hostAfter < hostBefore - 2) fail(`host was reset by guest glitch: ${hostBefore.toFixed(1)}s → ${hostAfter.toFixed(1)}s`)
// guest must recover and realign to the host (not stuck dead / at 0)
await guest
  .waitForFunction(
    () => {
      const v = document.getElementById('video')
      return v && v.readyState >= 1 && v.currentTime > 5
    },
    { timeout: 25000 }
  )
  .catch(() => fail('guest did not recover/realign after network glitch'))
const [hp3, gp3] = await Promise.all([
  host.evaluate(() => document.getElementById('video').currentTime),
  guest.evaluate(() => document.getElementById('video').currentTime),
])
console.log(`✓ glitch recovery — host kept ${hostAfter.toFixed(1)}s; realign host=${hp3.toFixed(1)}s guest=${gp3.toFixed(1)}s drift=${Math.abs(hp3 - gp3).toFixed(2)}s`)
if (Math.abs(hp3 - gp3) > 6) fail('post-glitch realign drift too large')

console.log('ALL PASS')
await browser.close()
process.exit(0)
