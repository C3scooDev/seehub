# SeeHub — Decisioni e fix chiave (sessione 2026-06-04)

Riepilogo delle scoperte, scelte architetturali e fix più importanti. Punto di
riferimento per capire *perché* il codice è fatto così.

---

## 1. Scoperta centrale: il token vixcloud NON è IP-bound — è CONDIVISIBILE

- **Credenza precedente (sbagliata):** il token m3u8 era legato all'IP di chi
  lo estrae → ogni peer doveva estrarre il suo. Era una **diagnosi errata** del
  bug `&h=1` (sotto).
- **Verifica empirica:** un peer su rete/IP diversa ha riprodotto l'm3u8 grezzo
  dell'host — master, varianti, chiave AES e segmenti `.ts` inclusi. → il token
  vale da qualsiasi IP.
- **Test usato:** canale debug `probe` — l'host manda il suo m3u8, il peer lo
  `fetch`a dal proprio browser/IP e poi lo carica nel player. 200 + riproduzione
  = condivisibile. (Canale rimosso dopo la conferma.)

### Conseguenza: SVOLTA ARCHITETTURALE (commit `ac036bd`)
- L'**host estrae UNA volta** (estensione) e condivide l'm3u8 sul canale `url`.
- **Ogni peer carica lo stesso stream in automatico.**
- **Per il guest: zero.** Apre il link e parte. iPad = HLS nativo Safari,
  desktop = hls.js. Niente estensione, niente Shortcut, niente incolla.
- Invito ora solo `?room=` (il guest non serve più `?ep=`).
- `UrlMsg = {url, fresh, position, paused}`. `fresh` = nuovo episodio (riparti
  da 0) vs token-refresh (riallinea, niente reload). `currentUrl` evita reload
  inutili quando l'host ri-condivide lo stesso stream su join/hello.

---

## 2. Bug ricorrente: vixcloud FLIP-FLOPPA il suffisso qualità (`&h=1`/`&b=1`/bare)

- Il token è firmato **includendo** (o no) il suffisso qualità. vixcloud ha
  cambiato idea ≥3 volte: serviva `&h=1` → poi solo bare (403 su h=1) → poi di
  nuovo `&h=1` (403 su bare, verificato su 10 episodi).
- **Fix definitivo (estensione v0.3.0, commit `bfe1cc7`):** non hard-codare mai
  un suffisso. `background.js` + `inject.js` fanno **HEAD-probe** di
  `['&h=1', '', '&b=1', '&h=1&b=1']` e usano la prima che dà 200. Adattivo →
  immune ai flip futuri.
- Lo Shortcut non può fare probe → `SHORTCUT.md` documenta l'ordine manuale.
- **L'estensione resta congelata su questa logica adattiva.** Non va più toccata
  per i flip.

---

## 3. Muro CORS: perché l'estrazione DEVE essere nativa (lato host)

Due muri distinti, spesso confusi:
- **CORS:** le pagine `iframe`/`embed` del sito NON mandano
  `Access-Control-Allow-Origin` → il JS della webapp non può leggerle. Solo
  l'm3u8 finale ha `ACAO: *` (per questo hls.js riproduce).
- **IP-binding:** si è rivelato **falso** (vedi punto 1). Era il vero presunto
  blocco, ora caduto.

**Verdetto scan GitHub:** nessuna patch open-source serve. Un CORS proxy
sposterebbe la fetch su un IP remoto (un tempo si pensava rompesse il token; ora
sappiamo che il token è condivisibile, ma il proxy resta inutile perché l'host
estrae comunque in locale con l'estensione). L'host estrae nativo (estensione);
il guest non estrae più nulla.

---

## 4. Sync: scelte di design

- **Transport:** MQTT-over-WSS su broker pubblico (`broker.emqx.io`), NON
  WebRTC. Entrambi i peer sono su hotspot mobile (CGNAT/NAT simmetrico) → P2P
  diretto impossibile senza TURN. Connessione outbound a un broker condiviso
  bypassa il NAT. Payload cifrati E2E (AES-GCM, chiave+topic dal room code a
  128 bit); il broker vede solo ciphertext.
- **Cambio episodio dinamico:** host estrae nuovo ep → condivide nuovo m3u8
  (`fresh`) → i peer ricaricano da 0.
- **Auto-realign su disconnessione:** ogni `hello` (a ogni riconnessione MQTT)
  fa ri-condividere all'host url+posizione → il peer rientrato carica e si
  riallinea subito (e2e: drift ~0.5s). Niente attesa dell'heartbeat.
- **Echo suppression:** pattern "consume-on-event expectation" (player.ts) —
  una mutazione remota imposta un'aspettativa consumata dall'unico evento
  nativo che genera. TTL anti-leak.

---

## 5. Pulizia fatta

- Rimossi canali morti dopo la svolta: `state`, `episode`, `probe`.
- Rimossi: pannello estrazione guest, pulsante "Apri episodio", pulsante Test.
- `e2e.mjs` riscritto sul modello shared-URL: il guest auto-riceve; la
  riconnessione auto-ricarica e riallinea (niente incolla manuale). Tutto verde.

---

## Stato e cose da ricordare

- **Estensione = congelata a v0.3.0** (logica adattiva). Solo l'host la usa.
- **Guest = nessun setup.** Apre il link e basta.
- Token ~6h: se scade, l'host ri-estrae (i peer ricevono il nuovo url).
- Repo: https://github.com/C3scooDev/seehub — push su `main` auto-deploya
  (GitHub Pages). Live: https://c3scoodev.github.io/seehub/
- Identità git personale (C3scooDev), mai email aziendale.
