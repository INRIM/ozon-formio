# Funzionalità del frontend Ozon

[English version](FRONTEND_FEATURES.en.md)

## Scopo

`ozon-app-web` è il frontend Angular di Ozon. L'applicazione costruisce navigazione, dashboard, liste e form a partire dalle risposte dell'Action Router e dagli schemi Form.io forniti dal backend.

Il frontend non contiene una configurazione applicativa rigida per ogni modello: interpreta il contratto del backend e adatta dinamicamente interfaccia, azioni e permessi.

## Tecnologie principali

- Angular 20 e TypeScript.
- Form.io per rendering e progettazione dei form.
- AG Grid per le tabelle desktop.
- Bootstrap Italia e Design Angular Kit per layout e stile.
- JSON Logic per condizioni e query dinamiche.
- Supporto JSON e NDJSON per il caricamento delle liste.

## Avvio dell'applicazione

Durante il bootstrap il frontend:

1. carica e normalizza la configurazione runtime;
2. sincronizza la sessione con il backend;
3. richiede il layout tramite `/action/layout`;
4. usa il menu incluso nel layout oppure `/action/menu` come fallback;
5. carica le card tramite `/action/dashboard`;
6. applica branding, identità utente e permessi amministrativi.

Una sessione non valida porta al percorso di login configurato. Gli errori server non vengono interpretati come sessioni anonime e sono mostrati come errori recuperabili.

## Configurazione runtime

La configurazione viene risolta, in ordine di precedenza, da:

1. query string;
2. `window.__OZON_APP_CONFIG__`;
3. `localStorage`, chiave `ozon-app-web.runtime`;
4. configurazione dell'environment Angular.

Le principali opzioni sono:

| Opzione | Funzione |
| --- | --- |
| `backendUrl` | URL del backend quando non si usa il proxy locale. |
| `siteUrl` | URL pubblico del frontend. |
| `allowedOrigins` | Origini autorizzate per navigazioni esterne controllate. |
| `useProxy` | Usa i percorsi `/api/*` inoltrati dal proxy. |
| `sessionCacheTtlMs` | Durata della cache di `/get_session`. |
| `authLoginPath` | Endpoint di login. |
| `authLogoutPath` | Endpoint di logout. |
| `authRefreshPath` | Endpoint di refresh della sessione. |
| `appCode` | Codice applicazione inviato quando richiesto dal backend. |
| `appModuleName` | Nome modulo usato come branding di fallback. |
| `appLogoUrl` | Logo usato quando il layout non ne fornisce uno. |

L'autenticazione effettiva è integrata con Keycloak attraverso il boundary HTTP. Il frontend non costruisce header trusted come `x-remote-user` e non deve contenere segreti.

## Navigazione e Action Router

Il backend è la sorgente canonica della navigazione. Ogni pulsante di menu usa prima `url_action`; `content` è accettato soltanto come compatibilità legacy.

| Percorso | Vista |
| --- | --- |
| `/dashboard` | Dashboard con card. |
| `/action/list_*` | Lista o tabella. |
| `/action/form_*` | Form Form.io. |
| `/action/next_action/{current_action}` | Risoluzione dell'azione per un nuovo record. |
| `/action/next_action/{current_action}/{rec_name}` | Risoluzione dell'azione per un record esistente. |
| `/record/{model}` | Schema diretto di un modello. |
| `/record/{model}/{rec_name}` | Record diretto con dati e schema. |

Il frontend gestisce le modalità di risposta `layout`, `menu`, `card`, `list`, `list_stream`, `form`, `redirect` e `action`. Una risposta `redirect` può indicare la destinazione tramite `next_page` o campi equivalenti supportati dal normalizzatore.

### Layout, menu e dashboard

- Il menu principale può essere raggruppato per `menu_group` e supporta payload raggruppati o flat.
- Le voci amministrative sono visibili soltanto agli utenti autorizzati e quando il Builder è abilitato.
- Le card della dashboard provengono esclusivamente da una risposta `mode: "card"`.
- Nome modulo, versione e logo possono essere forniti da `layout.data.settings`.
- Nome, avatar e ruoli dell'utente provengono dalla sessione backend.

## Contratto `ResponseObject`

Le viste principali sono pilotate da una risposta con questa forma:

```json
{
  "content": {
    "mode": "list",
    "data": [],
    "readable": true,
    "editable": true,
    "can_create": true,
    "model": "customer",
    "schema": {},
    "rec_name": "",
    "fields": {},
    "columns": {},
    "context_actions": []
  },
  "fail": false,
  "message": ""
}
```

Campi rilevanti:

| Campo | Uso frontend |
| --- | --- |
| `mode` | Seleziona il renderer della risposta. |
| `data` | Righe della lista o dati del form. |
| `model` | Modello attivo. |
| `schema` | Schema Form.io o schema collegato alla lista. |
| `rec_name` | Identificatore stabile del record. |
| `fields` | Metadati dell'azione, ricerca, pulsanti e sequenza. |
| `columns` | Mappa campo-etichetta della tabella. |
| `query` e `sort` | Query e ordinamento iniziali. |
| `total_count` e `batch_size` | Metadati di paginazione/stream. |
| `context_actions` | Azioni contestuali definite dal backend. |
| `editable` e `can_create` | Permessi che governano scrittura e readonly. |
| `editable_fields` | Elenco informativo dei campi modificabili restituito dal backend. |
| `obfucated_fields` | Campi da mostrare vuoti e readonly; il valore ricevuto viene rimosso anche dalla submission frontend. Sono supportati componenti Form.io annidati. |

## Liste

### Rendering e caricamento

- Le liste desktop usano AG Grid.
- Su schermi piccoli le righe diventano card responsive.
- Sono supportati payload JSON completi e stream `application/x-ndjson`.
- `rec_name` è sempre mantenuto internamente, anche quando non è presente nelle colonne visibili.
- Le colonne sono ricavate dall'header o dal campo `columns` della risposta.
- Il frontend mostra placeholder durante caricamento, preparazione schema e rendering celle.
- Un header colonne assente o non valido produce un avviso esplicito.

### Selezione e apertura

- Selezione singola o multipla delle righe.
- Apertura da riga, doppio click o azione dedicata.
- Apertura tramite `next_action`, mantenendo l'azione lista come origine del form.
- Azioni riga opzionali per copia e rimozione dalla vista.
- Riordinamento righe quando previsto dalla configurazione.

### Ordinamento e paginazione

- Ordinamento server-side ascendente o discendente.
- Controlli di ordinamento dedicati su mobile.
- Dimensione pagina configurabile.
- Navigazione prima, precedente, pagina specifica, successiva e ultima.
- Visualizzazione di intervallo corrente, totale e contatori dello stream.

### Filtri

Il query builder consente di:

- aggiungere e rimuovere regole;
- combinare regole con `AND` o `OR`;
- scegliere operatori coerenti con il tipo del campo;
- usare valori testuali, numerici, booleani e temporali;
- visualizzare la query MongoDB generata;
- applicare o azzerare il filtro in modo esplicito.

### Ricerca veloce

Quando `fields.fast_search` è configurato:

- viene renderizzato un form Form.io dedicato;
- la ricerca può partire da submit o dal tasto Invio su desktop;
- su mobile è disponibile un pulsante Cerca esplicito;
- stato e valori possono essere conservati temporaneamente per l'azione corrente;
- Reimposta ripristina la query base della lista;
- le select remote vengono idratate con la stessa infrastruttura dei form normali.

### Azioni rapide

Quando `fields.fast_actions` è configurato, il frontend mostra un form di azioni applicabili alla selezione corrente. Le azioni possono:

- richiedere una o più righe selezionate;
- inviare i `rec_name` selezionati al backend;
- mostrare conferme modali;
- aggiornare la lista al termine;
- produrre un risultato distinto per ogni riga.

### Import ed export

Gli strumenti di trasferimento sono disponibili agli amministratori quando configurati.

Export:

- formati XLS, CSV e JSON;
- esportazione completa o limitata alla ricerca/filtro corrente;
- etichette e visibilità configurabili dal backend.

Import:

- file `.xlsx`, `.xls`, `.csv` e `.json`;
- drag and drop o selezione file;
- anteprima della prima sheet;
- scelta dell'autore per i record nuovi;
- aggiornamento dei record esistenti identificati da `rec_name`;
- modalità esplicita di cancellazione completa e reimportazione;
- normalizzazione dei tipi e dei payload complessi Form.io;
- dettaglio degli errori restituiti dal backend.

## Azioni contestuali e permessi

### Sorgente dei pulsanti

La regola è unica per lista e form:

1. se `context_actions` è popolato, il frontend usa le azioni dichiarate dal backend per il contesto richiesto;
2. `context_button_mode` decide dove mostrare ogni azione: `list`, `form` oppure entrambi;
3. se `context_actions` è vuoto, il frontend costruisce i pulsanti di fallback;
4. i permessi filtrano sempre le azioni, sia quelle backend sia quelle di fallback.

Esempio:

```json
{
  "rec_name": "new_customer",
  "action_type": "window",
  "label": "Nuovo",
  "button_icon": "it-plus",
  "modal": false,
  "context_button_mode": ["list"],
  "url_action": "/action/new_customer"
}
```

### Regola readonly

Il form è modificabile soltanto quando entrambi i flag consentono la scrittura:

```text
editable === true AND can_create === true
```

Se `editable === false` **oppure** `can_create === false`:

- il viewer Form.io riceve `readOnly: true`;
- `Nuovo`, `Salva`, `Aggiorna`, `Copia/Duplica`, eliminazione e altre azioni mutative non vengono mostrate;
- le azioni mutative sono filtrate anche quando provengono da `context_actions`;
- le azioni non mutative, per esempio `Abbandona`, possono restare disponibili.

Se un flag non è presente, non viene interpretato automaticamente come negazione. Il backend deve inviare esplicitamente `false` per negare la scrittura.

### Pulsanti di fallback

In lista, in assenza di `context_actions`, possono essere costruiti:

- Apri record;
- Nuovo record, soltanto quando la scrittura è consentita;
- eventuali azioni riga configurate.

Nel form, in assenza di azioni backend, possono essere costruiti:

- Salva per un nuovo record;
- Aggiorna per un record esistente;
- Copia per un record esistente;
- Abbandona quando `fields.cancel_button` è vero.

`no_submit` nello schema rimuove il submit. `cancel_button` governa la presenza di Abbandona. L'origine della lista ha priorità come destinazione di Abbandona.

## Form

### Rendering Form.io

- Lo schema può arrivare direttamente nella risposta o essere caricato dal modello.
- I dati sono normalizzati prima della creazione della submission.
- I valori di default sono inseriti senza sovrascrivere valori reali.
- Componenti annidati, colonne, panel, datagrid e container sono attraversati ricorsivamente.
- La validazione Form.io viene eseguita prima delle azioni POST.
- Gli errori di validazione impediscono l'invio e sono mostrati all'utente.
- Le notifiche del backend possono essere mostrate sopra il form e conservate durante la navigazione richiesta.

### Sequenza di submit

I metadati possono essere definiti direttamente in `fields` o in `fields.action_sequence`:

```json
{
  "action_sequence": {
    "current_action": "list_customer",
    "submit_action": "form_form_customer",
    "submit_next_action": "submit_customer"
  }
}
```

Il frontend normalizza i nomi in percorsi `/action/...`, invia la submission corrente e gestisce la risposta successiva, inclusi redirect e ritorno alla lista.

### Select remote

- Caricamento opzioni tramite `/get_remote_select`.
- Supporto a `model`, `domain`, `id`, `label`, `compute_label` e URL remoti.
- Cache e deduplicazione delle richieste concorrenti.
- Idratazione iniziale e aggiornamento delle select dipendenti.
- Normalizzazione delle opzioni per backend legacy.
- Rendering leggibile delle etichette anche nelle celle tabella.
- Stile readonly dedicato per select Choices.js.

Per il contratto dettagliato vedere [REMOTE_SELECT_REQUEST.md](REMOTE_SELECT_REQUEST.md).

### File e allegati

- Template Form.io dedicato agli allegati Ozon.
- Download autenticato delegato al client API.
- Normalizzazione di URL e nomi file.
- Gestione coerente dei componenti file in viewer e builder.

### Componenti custom

- `ozon_data_table`: lista Ozon incorporata dentro un form Form.io.
- JSON editor basato su `vanilla-jsoneditor`.
- Editor WYSIWYG basato su Quill.
- Compatibilità Inputmask.
- Template file Ozon.

## Tabelle incorporate e form modali

Il componente `ozon_data_table` può:

- eseguire una action list indipendente dalla lista principale;
- ricevere query iniziali statiche o calcolate con JSON Logic;
- combinare il contesto del record padre con la query;
- mostrare o nascondere i filtri;
- aprire il record tramite navigazione normale;
- aprire e salvare un record in una modale senza sostituire la pagina corrente;
- ricaricare la tabella incorporata dopo il salvataggio.

## Form Builder

Il Builder è una funzione amministrativa:

- viene abilitato dal menu utente;
- rende disponibili menu e azioni amministrative;
- apre l'editor soltanto con un'azione esplicita;
- consente modifica visuale dello schema Form.io;
- include editor dedicati per proprietà JSON e contenuti HTML/WYSIWYG;
- conserva proprietà applicative come `queryformeditable` durante il salvataggio;
- usa lo stesso contratto di submit del form corrente;
- può essere esteso tramite `FORMIO_BUILDER_EXTENSIONS` senza riscrivere il builder base.

## Tema, responsive e accessibilità

- Tema chiaro/scuro con persistenza locale.
- Layout basato su Bootstrap Italia.
- Tabelle desktop e card mobile selezionate tramite breakpoint.
- Skeleton e `aria-busy` durante i caricamenti.
- Etichette ARIA sui controlli principali.
- Navigazione e pulsanti disabilitati quando l'azione non è eseguibile.
- Icone Bootstrap Italia con compatibilità per nomi provenienti da librerie legacy.

## Errori e stato applicativo

- Stato operativo e messaggi di errore visibili nella pagina.
- Banner globale per errori client non gestiti.
- Possibilità di chiudere l'errore, tornare alla dashboard o ricaricare.
- Gestione distinta di errori di autenticazione, errori server e risposte backend con `fail: true`.
- Protezione dalle risposte asincrone obsolete durante cambi pagina rapidi.
- Loader globale durante navigazioni, submit e import.

## Endpoint principali consumati

| Endpoint | Scopo |
| --- | --- |
| `GET /get_session` | Sessione e identità utente. |
| `GET /models/distinct` | Elenco modelli. |
| `GET /record/{model}` | Schema modello. |
| `GET /record/{model}/{rec_name}` | Dati e schema record. |
| `POST /list/{model}` | Lista JSON o NDJSON. |
| `GET /action/layout` | Layout applicativo. |
| `GET /action/menu` | Menu di fallback. |
| `GET /action/dashboard` | Card dashboard. |
| `GET /action/{name}[/{rec_name}]` | Esecuzione action in lettura. |
| `POST /action/{name}[/{rec_name}]` | Esecuzione action con submission. |
| `GET /action/next_action/...` | Risoluzione del passo successivo. |
| `POST /get_remote_select` | Opzioni delle select remote. |
| endpoint import/export | Trasferimento dati configurato per modello. |

## Sviluppo, test e build

```bash
cd ozon-app-web
npm install
npm start
```

Verifica automatica:

```bash
npm test
npm run build
```

In sviluppo `ng serve` usa `proxy.conf.json`. Nell'immagine Docker l'app viene compilata come sito statico e servita da Nginx; il proxy API viene configurato nel boundary Nginx.

## Documenti correlati

- [Integrazione Action Router, layout e menu](ACTION_ROUTER_LAYOUT_MENU.md)
- [Contratto remote select](REMOTE_SELECT_REQUEST.md)
- [README del frontend](../README.md)
