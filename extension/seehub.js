// Runs on the SeeHub page. Pulls the latest m3u8 captured from a vixcloud tab
// and hands it to the web app via postMessage, so the user never pastes.
// Also relays freshly-captured URLs that arrive while SeeHub is already open.
const FRESH_MS = 10 * 60 * 1000 // 10 min: avoid replaying a stale token

function deliver(url) {
  if (typeof url === 'string' && url) {
    window.postMessage({ type: 'SEEHUB_M3U8', url }, location.origin)
  }
}

// Initial pickup on load
chrome.runtime.sendMessage({ type: 'SEEHUB_GET_M3U8' }, (d) => {
  if (d && d.latestM3u8 && Date.now() - (d.latestAt || 0) < FRESH_MS) {
    deliver(d.latestM3u8)
  }
})

// Live updates while SeeHub stays open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.latestM3u8) {
    deliver(changes.latestM3u8.newValue)
  }
})
