# SeeHub — Apple Shortcut per iPad/iPhone (peer B)

Estrae l'm3u8 dal **IP dell'iPad** (token valido per quel dispositivo) e apre SeeHub già sincronizzato. Niente estensioni, niente App Store. Le richieste HTTP di Shortcuts sono native → niente blocco CORS.

## Perché serve

Il token vixcloud è firmato sull'IP di chi lo estrae: il link dell'host dà **403** sull'iPad. Lo Shortcut rifà l'estrazione localmente → token valido per l'iPad.

## Crea lo Shortcut (una volta sola)

App **Comandi** (Shortcuts) → **+** → rinominalo **esattamente** `SeeHub`. Aggiungi queste azioni in ordine:

1. **Ricevi → Comando rapido in ingresso** (input = Testo). Riceve `room|urlEpisodio`.
2. **Testo** → metti la variabile *Input del comando* → poi **Dividi testo** per **Personalizzato `|`**.
   - **Imposta variabile** `ROOM` = *Elemento 1* della divisione.
   - **Imposta variabile** `EP` = *Elemento 2* della divisione.
3. **Abbina testo** su `EP`, pattern: `watch/(\d+)` → **Ottieni gruppo** 1 → **Imposta variabile** `ID`.
4. **Abbina testo** su `EP`, pattern: `[?&]e=(\d+)` → **Ottieni gruppo** 1 → **Imposta variabile** `EPID`.
5. **Testo**: `https://streamingcommunityz.design/it/iframe/[ID]?episode_id=[EPID]` → **Imposta variabile** `IFRAME`.
6. **Ottieni contenuto di** `IFRAME`
   - Metodo GET, **Intestazioni**: `User-Agent` = `Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1`
7. **Abbina testo**, pattern: `https://vixcloud\.co/embed/[^"']+` → primo risultato → **Sostituisci testo** `&amp;` con `&` → **Imposta variabile** `EMBED`.
8. **Ottieni contenuto di** `EMBED`
   - GET, **Intestazioni**: `User-Agent` come sopra **+** `Referer` = `https://streamingcommunityz.design/`
   - **Imposta variabile** `HTML`.
9. **Abbina testo** su `HTML`, pattern `'token':\s*'([0-9a-f]+)'` → gruppo 1 → var `TOKEN`.
10. **Abbina testo** su `HTML`, pattern `'expires':\s*'(\d+)'` → gruppo 1 → var `EXP`.
11. **Abbina testo** su `HTML`, pattern `url:\s*'([^']+)'` → gruppo 1 → var `PURL`.
12. **Testo**: `[PURL]?token=[TOKEN]&expires=[EXP]&h=1` → **Codifica URL** → var `M3U8`.
13. **Testo**: `https://c3scoodev.github.io/seehub/?room=[ROOM]&m3u8=[M3U8]` → var `OPEN`.
14. **Apri URL** `OPEN`.

> Le azioni "Abbina testo" usano *espressioni regolari*: attiva l'opzione regex nell'azione. "Ottieni gruppo dal testo abbinato" estrae il gruppo `(...)`.

## Uso (ogni episodio)

1. L'host apre SeeHub, incolla l'**URL episodio** nel campo dedicato, copia il **link invito** (contiene `room` + `ep`) e lo manda a B.
2. B apre il link sull'iPad → SeeHub mostra **▶︎ Avvia** → tocca → parte lo Shortcut `SeeHub` → ti riporta su SeeHub col video caricato e sincronizzato.

## Note

- Token ~6h: se scade, B ri-tocca **Avvia**.
- Se Cloudflare un giorno blocca il GET: andrà aggiunto un header in più; per ora il GET semplice passa.
