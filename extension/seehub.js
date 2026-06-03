// Runs on the SeeHub page. Two jobs:
//  1. If the invite carries an episode (?ep=), ask the background worker to
//     resolve it natively (from this machine's IP) → m3u8, hands-off.
//  2. Hand any captured/resolved m3u8 to the web app via postMessage, so the
//     user never pastes anything.
const FRESH_MS = 10 * 60 * 1000 // 10 min: avoid replaying a stale token

function deliver(url) {
  if (typeof url === 'string' && url) {
    window.postMessage({ type: 'SEEHUB_M3U8', url }, location.origin)
  }
}

function resolve(ep) {
  if (ep) chrome.runtime.sendMessage({ type: 'SEEHUB_RESOLVE_EP', ep })
}

// 1a. Auto-resolve the episode in the invite link
resolve(new URLSearchParams(location.search).get('ep'))

// 1b. Or when the web app asks (e.g. host typed an episode URL)
window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== 'SEEHUB_RESOLVE') return
  resolve(event.data.ep)
})

// 2a. Initial pickup of an already-captured URL (episode opened in another tab)
chrome.runtime.sendMessage({ type: 'SEEHUB_GET_M3U8' }, (d) => {
  if (d && d.latestM3u8 && Date.now() - (d.latestAt || 0) < FRESH_MS) deliver(d.latestM3u8)
})

// 2b. Live updates (background resolved/captured a URL while SeeHub is open)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.latestM3u8) deliver(changes.latestM3u8.newValue)
})
