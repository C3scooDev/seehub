// Isolated world: bridges to the MAIN world via inject.js, then shows a
// floating button inside the vixcloud player frame. Clipboard write happens
// on click (user gesture required).
let m3u8Url = null

// Inject MAIN-world script to read window.masterPlaylist
const script = document.createElement('script')
script.src = chrome.runtime.getURL('inject.js')
script.onload = () => script.remove()
;(document.head || document.documentElement).appendChild(script)

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return
  if (event.data.type === 'SEEHUB_M3U8') {
    m3u8Url = event.data.url
    // Stash it so an already-open SeeHub tab can grab it automatically.
    chrome.runtime.sendMessage({ type: 'SEEHUB_SET_M3U8', url: m3u8Url })
    showButton()
  } else if (event.data.type === 'SEEHUB_M3U8_FAIL') {
    showButton('masterPlaylist non trovato', true)
  }
})

function showButton(label, disabled) {
  if (document.getElementById('seehub-copy-btn')) return
  const btn = document.createElement('button')
  btn.id = 'seehub-copy-btn'
  btn.textContent = label || '📋 SeeHub: copia m3u8'
  Object.assign(btn.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    background: '#e0506e',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 14px',
    font: '13px system-ui, sans-serif',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? '0.6' : '1',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  })
  if (!disabled) {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(m3u8Url)
        btn.textContent = '✓ Copiato!'
      } catch {
        // Fallback: prompt so the URL can be copied manually
        window.prompt('Copia manualmente:', m3u8Url)
      }
      setTimeout(() => {
        btn.textContent = '📋 SeeHub: copia m3u8'
      }, 2000)
    })
  }
  document.documentElement.appendChild(btn)
}
