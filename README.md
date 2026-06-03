# SeeHub

Guarda contenuti in streaming in sync con un'altra persona, **peer-to-peer**: nessun server proprio, nessun IP pubblico. Play, pausa e seek condivisi in entrambe le direzioni.

## Come funziona

- **Web app** (`webapp/`): player HLS ([hls.js](https://github.com/video-dev/hls.js)) + sync via **broker MQTT-over-WebSocket pubblico** (`broker.emqx.io`), end-to-end encrypted. Nessun account, nessun server proprio, nessun TURN.
- **Estensione browser** (`extension/`): serve solo all'host. Sulla pagina del player vixcloud aggiunge un bottone "copia m3u8" che legge `window.masterPlaylist` e compone l'URL dello stream.
- Lo streaming arriva direttamente dal CDN a entrambi i peer (CORS aperto sui playlist/segmenti): sul broker passano solo i messaggi di sync (pochi byte), per giunta cifrati.

### Perché un broker e non P2P/WebRTC?

Due hotspot mobili (CGNAT) hanno NAT simmetrico: il P2P diretto browser↔browser è impossibile senza un relay (TURN). Invece entrambi i browser si collegano **in uscita** allo stesso broker pubblico — e le connessioni in uscita passano sempre il CGNAT. I messaggi sono minuscoli, quindi WebRTC era sovradimensionato e dava solo il problema NAT.

## Setup

```bash
npm install
npm run dev          # webapp su http://localhost:5173
```

Estensione (solo host): `chrome://extensions` → Developer mode → "Load unpacked" → cartella `extension/`.

## Uso

1. **Host**: apri la webapp → "Crea stanza" → "Copia link invito" → mandalo all'altra persona.
2. **Ospite**: apre il link. Fine — nessuna installazione.
3. **Host**: apri l'episodio sul sito di streaming, clicca il bottone rosso "📋 SeeHub: copia m3u8" sul player, incolla nella webapp → "Carica". Il video parte su entrambi.
4. Play / pausa / seek di chiunque si propagano all'altro. Il drift si corregge da solo (heartbeat ogni 4s).

### Token scaduto (~6h)

Gli URL m3u8 di vixcloud scadono dopo ~6 ore. Se lo stream muore: l'host ri-estrae l'URL con l'estensione e lo incolla di nuovo — la posizione viene mantenuta su entrambi i lati.

### Se i peer non si connettono

Reti con NAT simmetrico su entrambi i lati bloccano il P2P diretto. Decommenta il blocco TURN in `webapp/src/config.ts` (es. free tier di metered.ca).

## Test

```bash
npm run dev &        # serve la webapp
node scripts/e2e.mjs # 2 browser headless: connessione, scambio URL, sync bidirezionale, drift
```

## Deploy

`npm run build` → `webapp/dist/` è statica (base relativa): GitHub Pages o qualsiasi hosting statico. Richiede https (o localhost) per WebCrypto/clipboard.

## Architettura sync

- **Transport**: broker MQTT-over-WSS pubblico. Il *codice stanza* (128 bit, nel link) è sia indirizzo che segreto: deriva il **topic** (hash → stanza non indovinabile) e la **chiave AES-GCM** (`crypto.ts`). Il broker vede solo ciphertext.
- **Presence**: ogni client annuncia `hello` all'ingresso e pinga ogni 5s; i peer scadono dopo 13s di silenzio → `onPeerLeave`.
- Chi carica l'URL è **host** = autorità di resync: heartbeat ogni 4s; l'ospite corregge il drift (hard seek > 1.5s, nudge del playbackRate tra 0.4–1.5s).
- Eco soppressa con "expectation consume-on-event": una mutazione applicata da remoto consuma l'unico evento nativo che genera, mai i successivi eventi reali dell'utente.
- Dopo un'azione locale dell'utente l'ospite ignora gli heartbeat per ~5.5s (lo stato dell'host è stale finché il ctrl non lo raggiunge).
- Su join del peer l'host invia lo stato completo (url, posizione, paused).
