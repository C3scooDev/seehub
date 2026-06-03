// Runs on the SeeHub page. Two jobs:
//  1. If the invite carries an episode (?ep=), ask the background worker to
//     resolve it natively (from this machine's IP) → m3u8, hands-off.
//  2. Hand any captured/resolved m3u8 to the web app via postMessage, so the
//     user never pastes anything.
// Uses chrome.storage.local (content scripts can read it + receive onChanged;
// storage.session is restricted to trusted contexts and would not work here).
const FRESH_MS = 10 * 60 * 1000 // 10 min: avoid replaying a stale token

function deliver(url) {
  if (typeof url === 'string' && url) {
    window.postMessage({ type: 'SEEHUB_M3U8', url }, location.origin)
  }
}

function resolve(ep) {
  if (!ep) return
  chrome.runtime.sendMessage({ type: 'SEEHUB_RESOLVE_EP', ep }, (resp) => {
    // success delivers via storage.onChanged; only surface failures here
    if (resp && resp.ok === false) {
      window.postMessage({ type: 'SEEHUB_M3U8_ERR', error: resp.error }, location.origin)
    }
  })
}

const ep = new URLSearchParams(location.search).get('ep')

if (ep) {
  // Fresh episode in the invite → resolve it (ignore any older stored URL).
  resolve(ep)
} else {
  // No episode: pick up an m3u8 captured from a vixcloud tab.
  chrome.storage.local.get(['latestM3u8', 'latestAt'], (d) => {
    if (d && d.latestM3u8 && Date.now() - (d.latestAt || 0) < FRESH_MS) deliver(d.latestM3u8)
  })
}

// Web app may ask us to resolve (host typed an episode URL)
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== 'SEEHUB_RESOLVE') return
  resolve(event.data.ep)
})

// Live updates: background resolved/captured a URL (storage.local fires in
// content scripts, unlike storage.session).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.latestM3u8) deliver(changes.latestM3u8.newValue)
})
