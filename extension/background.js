// Holds the most recently extracted m3u8 so the SeeHub tab can pick it up even
// if the episode was opened in a different tab.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'SEEHUB_SET_M3U8' && typeof msg.url === 'string') {
    chrome.storage.session
      .set({ latestM3u8: msg.url, latestAt: Date.now() })
      .then(() => sendResponse({ ok: true }))
    return true // async response
  }
  if (msg?.type === 'SEEHUB_GET_M3U8') {
    chrome.storage.session.get(['latestM3u8', 'latestAt']).then((d) => sendResponse(d))
    return true
  }
})
