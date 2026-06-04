// Runs in the page's MAIN world (injected via <script> tag by content.js):
// page globals like window.masterPlaylist are not visible from the content
// script's isolated world.
;(function () {
  // vixcloud flip-flops on the quality suffix (&h=1/&b=1) the token is signed
  // over. Probe each candidate (HEAD → 200, same-origin here) and post the one
  // the server actually serves. Adaptive = survives future flips.
  var VARIANTS = ['&h=1', '', '&b=1', '&h=1&b=1']

  function pick(base, i) {
    if (i >= VARIANTS.length) {
      window.postMessage({ type: 'SEEHUB_M3U8_FAIL' }, '*')
      return
    }
    var url = base + VARIANTS[i]
    fetch(url, { method: 'HEAD' })
      .then(function (r) {
        if (r.ok) window.postMessage({ type: 'SEEHUB_M3U8', url: url }, '*')
        else pick(base, i + 1)
      })
      .catch(function () {
        pick(base, i + 1)
      })
  }

  var tries = 0
  var timer = setInterval(function () {
    tries++
    var mp = window.masterPlaylist
    if (mp && mp.url && mp.params && mp.params.token) {
      clearInterval(timer)
      var base =
        mp.url +
        (mp.url.indexOf('?') === -1 ? '?' : '&') +
        'token=' +
        mp.params.token +
        '&expires=' +
        mp.params.expires
      pick(base, 0)
    } else if (tries > 40) {
      // ~10s: the inline script never showed up
      clearInterval(timer)
      window.postMessage({ type: 'SEEHUB_M3U8_FAIL' }, '*')
    }
  }, 250)
})()
