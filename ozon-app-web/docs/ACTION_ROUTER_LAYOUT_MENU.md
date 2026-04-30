# Integrazione Layout/Menu con Action Router

## Obiettivo
Questo frontend usa ora il router `action` come sorgente canonica per layout e menu, in linea con:
- `/action/layout`
- `/action/menu`
- `/action/dashboard`
- `/action/{name}`

Riferimento backend: `docs/ENDPOINTS_ACTION_ROUTER.en.md` (progetto `ozon-env-app`).

## Cosa e' stato cambiato
- Rimossa la configurazione manuale UI precedente (backend url, token, model, query builder) dalla vista principale.
- Rimossa l'intestazione `Menu operativo`.
- Bootstrap iniziale tramite:
  1. `GET /action/layout`
  2. fallback su `GET /action/menu` se il layout non include menu.
  3. `GET /action/dashboard` per le card.
  4. `GET /get_session` per utente loggato (`full_name`, `avatar`, `is_admin`) e permessi builder.
- I pulsanti menu con path `/action/...` eseguono `GET /action/{name}` o `GET /action/{name}/{rec_name}`.
- Le risposte `mode=list|form|menu|card|layout|action` vengono gestite direttamente nel componente Angular.
- Layout dashboard allineato al mock operativo: barra top con menu a tendina + griglia card.
- Header menu:
  - sorgente: `layout.data.menu` (fallback `GET /action/menu`)
  - payload supportato: lista di gruppi con chiavi dinamiche (es. `{ "Config": [ ... ] }`)
- Card dashboard:
  - sorgente esclusiva: `mode=card` (`GET /action/dashboard` o action che ritorna `mode=card`)
  - non vengono mai costruite dal payload `menu`
  - in UI vengono mostrate solo card non `admin`
- Branding header:
  - `layout.data.settings.module_name`
  - `layout.data.settings.app_version` (fallback `version`)
  - `layout.data.settings.logo` / `logo_img_url`
- Nome utente header letto da sessione/token runtime (non hardcoded).
- Drill-down:
  - click su item menu usa sempre `url_action` (campo canonico; `content` e' solo fallback legacy)
  - raggruppamento menu top basato su `menu_group`
  - supportati sia payload dinamici (`{ "Config": [ ... ] }`) sia payload flat (array di action con `menu_group`)
- Routing UI:
  - `/dashboard` => solo dashboard card (no tabella)
  - `/action/list_*` => vista lista/tabella
  - `/action/form_*` => vista form
  - doppio click su riga tabella in `list_*`:
    - apre `/action/next_action/{current_action}/{rec_name}`
    - invia `next_action` al backend e imposta in URL solo il path di redirect restituito
    - payload supportato: `{"mode":"redirect","data":{"next_page":"/action/form_*/*"}}`, esegue hard reload su `next_page`
  - pulsante `Nuovo record` in lista:
    - apre `/action/next_action/{current_action}` (senza `rec_name`)
- Toggle `Builder` (menu utente):
  - `OFF`: menu `admin` nascosto/disabilitato, builder mode spento.
  - `ON`: menu `admin` abilitato; i form restano in viewer all'apertura e passano in `form-builder` solo con click esplicito su `Modifica form`.

## Table row contract
- Le righe tabella mantengono sempre `rec_name` valorizzato internamente.
- Se `rec_name` e' presente nelle colonne header backend viene mostrato.
- Se non e' presente nelle colonne header resta disponibile ma non visibile (usato per select/doppio click/next_action).

## Compatibilita' remote select (`/get_remote_select`)
Per evitare `KeyError: 'label'` su backend legacy durante la costruzione opzioni select:
- il payload frontend ora valorizza sempre `properties.label` e `properties.id` quando assenti,
- mantiene `data.url`, `data.pathValue`, `headers` come da schema componente,
- per URL assoluti (`http/https`) il frontend usa il ramo diretto remoto (`data.url`) senza forzare `key/curr_model`, evitando il path legacy che genera l'eccezione.

In questo modo i backend non ancora aggiornati non vanno in errore su select URL-based senza `label` esplicita.

## Note operative
- Il token rimane richiesto a runtime (`Authorization` o header configurato lato runtime config).
- Se `layout.menu` e' vuoto, viene invocato automaticamente `/action/menu`.
- Il rendering form continua a usare Form.io con idratazione delle select remote.
