# RemoteSelectRequest Alignment

## Scope
Questo documento allinea il payload frontend `RemoteSelectRequest` al contratto backend descritto in:
- `/Users/archetipo/devel/microservices/dev_libs/ozon-env-app/docs/ENDPOINTS_REMOTE_SELECT_TECHNICAL.en.md`

## Payload canonico

### 1) Sorgente interna FormIO (`key + curr_model`)
Usato quando il select non punta a URL assoluto (`http/https`).

Payload inviato:
- `key`
- `curr_model`
- `data`:
  - `pathValue`
  - `headers`
  - `headerKey`
  - `headerValueKey`
- `properties`:
  - `src`
  - `model`
  - `domain`
  - `compute_label`
  - `label`
  - `id`

### 2) Sorgente URL remota (`data.url`)
Usato quando l'URL del componente e' assoluto (`http://` o `https://`).

Payload inviato:
- `key: ""`
- `curr_model: ""`
- `data`:
  - `url`
  - `pathValue`
  - `headers`
  - `headerKey`
  - `headerValueKey`
- `properties: {}`

Questo forza il ramo backend corretto:
- `elif payloadr.data.url: ... remote_data_select_response(...)`

## Normalizzazione risposta
Il frontend normalizza le varianti di risposta backend:
- `content.data`
- `data.items`
- `data.records`
- `data.values`
- elementi in formato:
  - `{ label, value }`
  - `{ k, v }`
  - fallback su `{ id/name/title/... }`

Risultato finale interno: array uniforme `{ label, value }`.
