// Resolves an episode page URL → playable m3u8, entirely in the background.
// The service worker has host_permissions for the site, so its fetches bypass
// CORS and originate from THIS machine's IP → the token is valid here. This is
// what makes peer B fully hands-off: open the invite link, video loads itself.

const SITE = 'https://streamingcommunityz.design'

async function resolveEpisode(ep) {
  const id = ep.match(/watch\/(\d+)/)?.[1]
  const epid = ep.match(/[?&]e=(\d+)/)?.[1]
  if (!id || !epid) throw new Error('URL episodio non valido')

  const iframeUrl = `${SITE}/it/iframe/${id}?episode_id=${epid}`
  const t1 = await (await fetch(iframeUrl)).text()
  const embed = t1.match(/https:\/\/vixcloud\.co\/embed\/[^"']+/)?.[0]?.replace(/&amp;/g, '&')
  if (!embed) throw new Error('embed vixcloud non trovato')

  const t2 = await (await fetch(embed)).text()
  const token = t2.match(/'token':\s*'([0-9a-f]+)'/)?.[1]
  const expires = t2.match(/'expires':\s*'(\d+)'/)?.[1]
  const purl = t2.match(/url:\s*'(https:\/\/vixcloud\.co\/playlist\/[^']+)'/)?.[1]
  const fhd = /canPlayFHD\s*=\s*true/.test(t2)
  if (!token || !expires || !purl) throw new Error('masterPlaylist non trovata')

  return `${purl}?token=${token}&expires=${expires}${fhd ? '&h=1' : '&b=1'}`
}

async function storeM3u8(url) {
  await chrome.storage.session.set({ latestM3u8: url, latestAt: Date.now() })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // From the vixcloud content script (already-extracted URL)
  if (msg?.type === 'SEEHUB_SET_M3U8' && typeof msg.url === 'string') {
    storeM3u8(msg.url).then(() => sendResponse({ ok: true }))
    return true
  }
  // From the SeeHub page: resolve an episode URL natively
  if (msg?.type === 'SEEHUB_RESOLVE_EP' && typeof msg.ep === 'string') {
    resolveEpisode(msg.ep)
      .then((url) => storeM3u8(url))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
    return true
  }
  if (msg?.type === 'SEEHUB_GET_M3U8') {
    chrome.storage.session.get(['latestM3u8', 'latestAt']).then((d) => sendResponse(d))
    return true
  }
})
