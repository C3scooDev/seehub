// Runs in the page's MAIN world (injected via <script> tag by content.js):
// page globals like window.masterPlaylist are not visible from the content
// script's isolated world.
;(function () {
  var tries = 0
  var timer = setInterval(function () {
    tries++
    var mp = window.masterPlaylist
    if (mp && mp.url && mp.params && mp.params.token) {
      clearInterval(timer)
      var url =
        mp.url +
        (mp.url.indexOf('?') === -1 ? '?' : '&') +
        'token=' +
        mp.params.token +
        '&expires=' +
        mp.params.expires +
        (window.canPlayFHD ? '&h=1' : '&b=1')
      window.postMessage({ type: 'SEEHUB_M3U8', url: url }, '*')
    } else if (tries > 40) {
      // ~10s: the inline script never showed up
      clearInterval(timer)
      window.postMessage({ type: 'SEEHUB_M3U8_FAIL' }, '*')
    }
  }, 250)
})()
