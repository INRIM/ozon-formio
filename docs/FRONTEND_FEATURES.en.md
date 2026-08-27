# Ozon frontend features

[Versione italiana](FRONTEND_FEATURES.it.md)

## Purpose

`ozon-app-web` is the Angular frontend for Ozon. It builds navigation, dashboards, lists, and forms from Action Router responses and Form.io schemas supplied by the backend.

The frontend does not contain a rigid application configuration for each model. It interprets the backend contract and dynamically adapts the interface, actions, and permissions.

## Main technologies

- Angular 20 and TypeScript.
- Form.io for form rendering and design.
- AG Grid for desktop tables.
- Bootstrap Italia and Design Angular Kit for layout and styling.
- JSON Logic for conditions and dynamic queries.
- JSON and NDJSON support for list loading.

## Application startup

During bootstrap, the frontend:

1. loads and normalizes runtime configuration;
2. synchronizes the session with the backend;
3. requests the layout through `/action/layout`;
4. uses the menu included in the layout or `/action/menu` as fallback;
5. loads cards through `/action/dashboard`;
6. applies branding, user identity, and administrative permissions.

An invalid session leads to the configured login path. Server errors are not treated as anonymous sessions and are displayed as recoverable errors.

## Runtime configuration

Configuration is resolved in the following precedence order:

1. query string;
2. `window.__OZON_APP_CONFIG__`;
3. `localStorage`, key `ozon-app-web.runtime`;
4. Angular environment configuration.

The main options are:

| Option | Purpose |
| --- | --- |
| `backendUrl` | Backend URL when the local proxy is not used. |
| `siteUrl` | Public frontend URL. |
| `allowedOrigins` | Origins allowed for controlled external navigation. |
| `useProxy` | Uses `/api/*` paths forwarded by the proxy. |
| `sessionCacheTtlMs` | Cache lifetime for `/get_session`. |
| `authLoginPath` | Login endpoint. |
| `authLogoutPath` | Logout endpoint. |
| `authRefreshPath` | Session refresh endpoint. |
| `appCode` | Application code sent when required by the backend. |
| `appModuleName` | Module name used as fallback branding. |
| `appLogoUrl` | Logo used when the layout does not supply one. |

Authentication is integrated with Keycloak through the HTTP boundary. The frontend never builds trusted headers such as `x-remote-user` and must not contain secrets.

## Navigation and Action Router

The backend is the canonical navigation source. Each menu button uses `url_action` first; `content` is accepted only for legacy compatibility.

| Path | View |
| --- | --- |
| `/dashboard` | Card dashboard. |
| `/action/list_*` | List or table. |
| `/action/form_*` | Form.io form. |
| `/action/next_action/{current_action}` | Resolves the action for a new record. |
| `/action/next_action/{current_action}/{rec_name}` | Resolves the action for an existing record. |
| `/record/{model}` | Direct model schema. |
| `/record/{model}/{rec_name}` | Direct record with data and schema. |

The frontend handles `layout`, `menu`, `card`, `list`, `list_stream`, `form`, `redirect`, and `action` response modes. A `redirect` response may provide its destination through `next_page` or equivalent fields supported by the normalizer.

### Layout, menu, and dashboard

- The main menu can be grouped by `menu_group` and supports grouped or flat payloads.
- Administrative entries are available only to authorized users while Builder mode is enabled.
- Dashboard cards come exclusively from a `mode: "card"` response.
- Module name, version, and logo may be supplied by `layout.data.settings`.
- User name, avatar, and roles come from the backend session.

## `ResponseObject` contract

Main views are driven by a response shaped as follows:

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

Relevant fields:

| Field | Frontend use |
| --- | --- |
| `mode` | Selects the response renderer. |
| `data` | List rows or form data. |
| `model` | Active model. |
| `schema` | Form.io schema or schema associated with the list. |
| `rec_name` | Stable record identifier. |
| `fields` | Action, search, button, and sequence metadata. |
| `columns` | Table field-to-label map. |
| `query` and `sort` | Initial query and ordering. |
| `total_count` and `batch_size` | Pagination/stream metadata. |
| `context_actions` | Context actions defined by the backend. |
| `editable` and `can_create` | Permissions controlling writes and read-only mode. |
| `editable_fields` | Informational list of editable fields returned by the backend. |
| `obfucated_fields` | Fields rendered empty and read-only; received values are also removed from the frontend submission. Nested Form.io components are supported. |

## Lists

### Rendering and loading

- Desktop lists use AG Grid.
- On small screens, rows become responsive cards.
- Full JSON payloads and `application/x-ndjson` streams are supported.
- `rec_name` is always kept internally, even when it is not a visible column.
- Columns are taken from response headers or the response `columns` field.
- Placeholders are displayed while loading data, preparing schemas, and rendering cells.
- A missing or invalid columns header produces an explicit warning.

### Selection and opening

- Single or multiple row selection.
- Opening from a row, double click, or dedicated action.
- Opening through `next_action`, retaining the list action as the form origin.
- Optional row actions for copying and removing a row from the view.
- Row reordering when enabled by configuration.

### Sorting and pagination

- Ascending or descending server-side sorting.
- Dedicated mobile sorting controls.
- Configurable page size.
- First, previous, specific page, next, and last navigation.
- Current range, total, and stream counters.

### Filters

The query builder supports:

- adding and removing rules;
- combining rules with `AND` or `OR`;
- selecting operators appropriate for the field type;
- text, numeric, Boolean, and temporal values;
- previewing the generated MongoDB query;
- explicitly applying or clearing filters.

### Fast search

When `fields.fast_search` is configured:

- a dedicated Form.io search form is rendered;
- search may start from form submit or Enter on desktop;
- mobile provides an explicit Search button;
- state and values may be temporarily preserved for the current action;
- Reset restores the base list query;
- remote selects are hydrated through the same infrastructure as regular forms.

### Fast actions

When `fields.fast_actions` is configured, the frontend displays an action form that operates on the current selection. Actions may:

- require one or more selected rows;
- send selected `rec_name` values to the backend;
- show confirmation modals;
- refresh the list on completion;
- return a distinct result for each row.

### Import and export

Transfer tools are available to administrators when configured.

Export:

- XLS, CSV, and JSON formats;
- complete export or export limited to the current search/filter;
- backend-configurable labels and visibility.

Import:

- `.xlsx`, `.xls`, `.csv`, and `.json` files;
- drag and drop or file selection;
- first-sheet preview;
- author selection for new records;
- update of existing records identified by `rec_name`;
- explicit delete-all-and-reimport mode;
- type and complex Form.io payload normalization;
- detailed backend error reporting.

## Context actions and permissions

### Button source

The same rule applies to lists and forms:

1. when `context_actions` is populated, the frontend uses the backend-declared actions for the requested context;
2. `context_button_mode` selects where each action appears: `list`, `form`, or both;
3. when `context_actions` is empty, the frontend builds fallback buttons;
4. permissions always filter actions, whether they came from the backend or from fallback logic.

Example:

```json
{
  "rec_name": "new_customer",
  "action_type": "window",
  "label": "New",
  "button_icon": "it-plus",
  "modal": false,
  "context_button_mode": ["list"],
  "url_action": "/action/new_customer"
}
```

### Read-only rule

A form is editable only when both flags allow writing:

```text
editable === true AND can_create === true
```

If `editable === false` **or** `can_create === false`:

- the Form.io viewer receives `readOnly: true`;
- New, Save, Update, Copy/Duplicate, delete, and other mutating actions are hidden;
- mutating actions are filtered even when they come from `context_actions`;
- non-mutating actions, such as Abandon, may remain available.

If a flag is absent, it is not automatically treated as a denial. The backend must explicitly send `false` to deny write access.

### Fallback buttons

In a list without `context_actions`, the frontend may build:

- Open record;
- New record, only when writes are allowed;
- optional configured row actions.

In a form without backend actions, the frontend may build:

- Save for a new record;
- Update for an existing record;
- Copy for an existing record;
- Abandon when `fields.cancel_button` is true.

`no_submit` in the schema removes submit. `cancel_button` controls the presence of Abandon. The originating list takes precedence as the Abandon destination.

## Forms

### Form.io rendering

- The schema may be included in the response or loaded from the model.
- Data is normalized before creating the submission.
- Default values are seeded without replacing actual values.
- Nested components, columns, panels, datagrids, and containers are traversed recursively.
- Form.io validation runs before POST actions.
- Validation errors block submission and are displayed to the user.
- Backend notifications can appear above the form and survive the required navigation.

### Submit sequence

Metadata may be defined directly in `fields` or inside `fields.action_sequence`:

```json
{
  "action_sequence": {
    "current_action": "list_customer",
    "submit_action": "form_form_customer",
    "submit_next_action": "submit_customer"
  }
}
```

The frontend normalizes names into `/action/...` paths, sends the current submission, and handles the following response, including redirects and returning to the list.

### Remote selects

- Option loading through `/get_remote_select`.
- Support for `model`, `domain`, `id`, `label`, `compute_label`, and remote URLs.
- Caching and deduplication of concurrent requests.
- Initial hydration and refresh of dependent selects.
- Option normalization for legacy backends.
- Human-readable label rendering in table cells.
- Dedicated read-only styling for Choices.js selects.

See [REMOTE_SELECT_REQUEST.md](REMOTE_SELECT_REQUEST.md) for the detailed contract.

### Files and attachments

- Dedicated Ozon Form.io attachment template.
- Authenticated download delegated to the API client.
- URL and filename normalization.
- Consistent file component handling in viewer and Builder.

### Custom components

- `ozon_data_table`: an Ozon list embedded in a Form.io form.
- JSON editor based on `vanilla-jsoneditor`.
- WYSIWYG editor based on Quill.
- Inputmask compatibility.
- Ozon file template.

## Embedded tables and modal forms

The `ozon_data_table` component can:

- run a list action independently from the main list;
- receive static initial queries or queries calculated with JSON Logic;
- combine parent-record context with the query;
- show or hide filters;
- open records through normal navigation;
- open and save a record in a modal without replacing the current page;
- reload the embedded table after saving.

## Form Builder

Builder is an administrative feature:

- enabled from the user menu;
- exposes administrative menus and actions;
- opens the editor only after an explicit action;
- provides visual Form.io schema editing;
- includes dedicated JSON property and HTML/WYSIWYG editors;
- preserves application properties such as `queryformeditable` during save;
- uses the current form submit contract;
- can be extended through `FORMIO_BUILDER_EXTENSIONS` without rewriting the base builder.

## Theme, responsive behavior, and accessibility

- Light/dark theme with local persistence.
- Bootstrap Italia-based layout.
- Desktop tables and mobile cards selected through breakpoints.
- Skeletons and `aria-busy` during loading.
- ARIA labels on main controls.
- Navigation and buttons disabled when an action cannot run.
- Bootstrap Italia icons with compatibility mappings for legacy icon names.

## Errors and application state

- Visible operational status and error messages.
- Global banner for unhandled client errors.
- Options to dismiss the error, return to the dashboard, or reload.
- Separate handling for authentication errors, server errors, and backend responses with `fail: true`.
- Protection against stale asynchronous responses during rapid page changes.
- Global loader during navigation, submit, and import operations.

## Main consumed endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /get_session` | User session and identity. |
| `GET /models/distinct` | Model list. |
| `GET /record/{model}` | Model schema. |
| `GET /record/{model}/{rec_name}` | Record data and schema. |
| `POST /list/{model}` | JSON or NDJSON list. |
| `GET /action/layout` | Application layout. |
| `GET /action/menu` | Fallback menu. |
| `GET /action/dashboard` | Dashboard cards. |
| `GET /action/{name}[/{rec_name}]` | Read action execution. |
| `POST /action/{name}[/{rec_name}]` | Action execution with submission. |
| `GET /action/next_action/...` | Next-step resolution. |
| `POST /get_remote_select` | Remote select options. |
| configured import/export endpoints | Per-model data transfer. |

## Development, tests, and build

```bash
cd ozon-app-web
npm install
npm start
```

Automated verification:

```bash
npm test
npm run build
```

During development, `ng serve` uses `proxy.conf.json`. In the Docker image, the application is compiled as a static site and served by Nginx; API proxying is configured at the Nginx boundary.

## Related documents

- [Action Router, layout, and menu integration](ACTION_ROUTER_LAYOUT_MENU.md)
- [Remote select contract](REMOTE_SELECT_REQUEST.md)
- [Frontend README](../README.md)
