# SeeHub

Guarda contenuti in streaming in sync con un'altra persona, **peer-to-peer**: nessun server proprio, nessun IP pubblico. Play, pausa e seek condivisi in entrambe le direzioni.

## Come funziona

- **Web app** (`webapp/`): player HLS ([hls.js](https://github.com/video-dev/hls.js)) + sync via **broker MQTT-over-WebSocket pubblico** (`broker.emqx.io`), end-to-end encrypted. Nessun account, nessun server proprio, nessun TURN.
- **Estensione browser** (`extension/`, desktop Chrome/Edge): il service worker, dato l'URL episodio nell'invito, **risolve l'm3u8 in background** (fetch cross-origin che bypassa CORS, dal IP della macchina) e lo consegna a SeeHub. Su PC l'ospite apre solo il link → **zero click**. Fallback: cattura dal player vixcloud + bottone "copia m3u8".
- **Apple Shortcut** (`SHORTCUT.md`, iPad/iPhone): estrattore nativo per chi non può installare estensioni.
- Lo streaming arriva direttamente dal CDN a entrambi i peer (CORS aperto sui playlist/segmenti): sul broker passano solo i messaggi di sync (pochi byte), per giunta cifrati.

### Perché un broker e non P2P/WebRTC?

Due hotspot mobili (CGNAT) hanno NAT simmetrico: il P2P diretto browser↔browser è impossibile senza un relay (TURN). Invece entrambi i browser si collegano **in uscita** allo stesso broker pubblico — e le connessioni in uscita passano sempre il CGNAT. I messaggi sono minuscoli, quindi WebRTC era sovradimensionato e dava solo il problema NAT.

## Setup

```bash
npm install
npm run dev          # webapp su http://localhost:5173
```

Estensione (solo host): `chrome://extensions` → Developer mode → "Load unpacked" → cartella `extension/`.

## Il vincolo chiave: token legato all'IP

Il token vixcloud è **firmato sull'IP** di chi lo estrae. Quindi **l'URL m3u8 NON è condivisibile** tra reti diverse: il link dell'host dà `403` all'altro peer. Ogni peer deve estrarre il **proprio** link, dal proprio IP. La sync condivide solo play/pausa/seek/posizione — mai l'URL.

Per questo l'estrazione dev'essere **nativa** (browser blocca i GET cross-origin verso il sito): estensione (desktop) o Apple Shortcut (iPad). Entrambi girano dall'IP del dispositivo.

## Uso

1. **Host**: webapp → "Crea stanza". Incolla l'**URL episodio** (es. `.../it/watch/1955?e=82376`) nel campo apposito → "Copia link invito" (contiene `room` + `ep`) → mandalo all'altra persona.
2. **Host carica il suo video**: apri l'episodio sul sito → con l'estensione installata il video si carica **da solo** nella webapp (oppure bottone rosso "copia m3u8" → incolla).
3. **Ospite** apre il link:
   - **PC/Windows** (estensione installata): **niente da fare** — l'estensione risolve l'episodio in background e il video si carica da solo. (Se non parte, bottone "Apri episodio" come fallback.)
   - **iPad** (Shortcut "SeeHub" installato, vedi [SHORTCUT.md](SHORTCUT.md)): tocca "▶︎ Avvia" → estrae e torna sincronizzato.
4. Play / pausa / seek di chiunque si propagano. Il drift si corregge da solo (heartbeat ogni 4s).

### Token scaduto (~6h)

Gli URL scadono dopo ~6h. Riapri l'episodio (PC) o ri-tocca "Avvia" (iPad): la posizione viene mantenuta.

### I peer si connettono sempre?

Sì: il sync passa per un broker pubblico raggiunto **in uscita** da entrambi → niente problema NAT/CGNAT, niente TURN.

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
