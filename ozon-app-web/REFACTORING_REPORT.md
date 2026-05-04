# REFACTORING_REPORT — Duplicate Functions Analysis
**Data**: 2025-05-04  
**Project**: ozon-app-web (Angular 19)  
**Branch**: Create feature branch

---

## 📊 METRICS

| Metric | Value |
|---|---|
| Total files in `/app` | 26 |
| Private methods by file | See below |
| `isRecord()` occurrences | 6 files |
| `readFirstString()` occurrences | 5 files |
| `parseJsonOrText()` occurrences | 3 files |
| Duplicate helper patterns | ~20 |

---

## 📁 FILE INVENTORY (private methods count)

| File | Private methods |
|---|---|
| `runtime-config.service.ts` | 22 |
| `ozon-api.service.ts` | 37 |
| `app-action-manager.service.ts` | ~50+ |
| `app-manager.service.ts` | ~40+ |
| `app-table-manager.service.ts` | ~40+ |
| `app-formio-renderer.service.ts` | ~35+ |
| `app-formio-builder.service.ts` | ~30+ |
| `main-manager.service.ts` | ~25+ |
| `formio/ozon-form-builder-host.component.ts` | ~20+ |
| ... | `...` |

---

## 🔍 DUPLICATE PATTERNS — 6 Exact Matches

### 1. `isRecord()` — **6 files** (identical, line-by-line)
Same logic: `return !!v && typeof v === 'object' && !Array.isArray(v);`

| File | Line |
|--- |---|---|
| `core/ozon-api.service.ts` | 547 |
| `core/runtime-config.service.ts` | ~47 |
| `core/main-manager.service.ts` | 231 |
| `managers/app-manager.service.ts` | 58 |
| `managers/app-action-manager.service.ts` | 47 |
| `managers/app-table-manager.service.ts` | 72 |
| `formio/ozon-form-builder-host.component.ts` | 205 |

**Impact**: 8+ usages per file × 6 files = **~60 calls**

**Refactor**: Extract to `core/utils.ts`, import in all 6 files (+2 new files)

---

### 2. `readFirstString(...candidates): string` — **5 files**
Same logic: loop over candidates, return first trimmed non-empty string

| File | Line |
|--- |---|---|
| `core/runtime-config.service.ts` | 223-231 (`pickFirstString`) |
| `core/app-manager.service.ts` | 308-313 |
| `managers/app-action-manager.service.ts` | 50-53 |
| `managers/app-table-manager.service.ts` | 560-564 |
| `managers/app-formio-builder.service.ts` | ~variable location |
| `app.component.ts` | Getter exposure |

**Impact**: 10+ usages per file × 5 files = **~60 calls**

**Refactor**: Extract to `core/utils.ts`, use `readFirstString()` in all files

---

### 3. `parseJsonOrText()` / `parseJsonMaybe()` — **3 files**
Same logic: `try { return JSON.parse(t); } catch { return t; }`

| File | Line |
|--- |---|
| `core/ozon-api.service.ts` | 545 |
| `managers/app-action-manager.service.ts` | 58-66 |
| `managers/app-table-manager.service.ts` | 559-561 |

**Impact**: 15+ usages across 3 files

**Refactor**: Extract to `core/utils.ts` (already exists)

---

### 4. `normalize*()` helper family — 4+ files, similar patterns

| Pattern | runtime-config | ozon-api | app-action | app-manager |
|--- |--- |--- |--- |--- |
| `normalizeBackendUrl` | `normalizeBackendUrl` (178-180) | N/A | N/A | `normalizeAbsoluteHttpUrl` (76) |
| `normalizeSiteUrl` | `normalizeSiteUrl` (182-192) | N/A | N/A | N/A |
| `normalizeEndpointPath` | `normalizeEndpointPath` (204-213) | `buildEndpointUrl` (533-543) | `normalizeRunnableMenuPath` (849) | `resolvePath` |
| `normalizeAuthMode` | `normalizeAuthMode` (194-196) | N/A | `normalizeMenuType` (873) | `normalizeSessionLocale` |
| `normalizeSessionCacheTtlMs` | `normalizeSessionCacheTtlMs` (198-202) | `resolveSessionCacheTtlMs` (545) | N/A | `resolveSessionCacheTtlMs` (247) |

**Impact**: Each pattern duplicated ~3-5 times, 20+ total `normalize*` calls

**Refactor**: Extract URL/helpers to `core/url.service.ts`, reuse in all files

---

### 5. `toBooleanFlag()` / `toOptionalBooleanFlag()` — 3 files
Same logic: parse boolean from string with fallback

| File | Line |
|--- |---|
| `core/runtime-config.service.ts` | 250-266 (`pickFirstBoolean`) |
| `managers/app-action-manager.service.ts` | 316-325 (`toBooleanFlag`) |
| `managers/app-manager.service.ts` | ~328-337 |

**Impact**: ~25 usages across 3 files

**Refactor**: Extract to `core/utils.ts` (already exists)

---

### 6. `parseNonNegativeInt()` — 2 files
Same logic: normalize number with floor validation

| File | Line |
|--- |---|
| `core/ozon-api.service.ts` | 359-364 |
| `managers/app-table-manager.service.ts` | 553-559 |

**Impact**: ~10 usages across 2 files

**Refactor**: Extract to `core/utils.ts` (already exists)

---

### 7. `extractOrigin()` vs `extractSessionRecord()` — 2 files
Same logic: `new URL()` + origin extraction / record extraction from `content.data`

| File | Line |
|--- |---|
| `core/runtime-config.service.ts` | 343-354 (`extractOrigin`) |
| `managers/app-manager.service.ts` | 416-434 (`extractSessionRecord`) |

**Impact**: ~5 usages each

**Refactor**: Extract to `core/utils.ts`

---

### 8. Other notable patterns (similar but not identical)

| Pattern | Files |
|--- |--- |
| `normalizeRecordList()` | `ozon-api` |
| `normalizeTableColumnsPayload()` | `app-table` |
| `normalizeActionMenuCards()` | `app-action` |
| `normalizeActionUrl()` | `app-action` |
| `normalizeFormTableComponents()` | `app-formio-renderer`, `app-table` |
| `normalizeFormWysiwygComponents()` | `app-formio-renderer` |
| `normalizeRemoteHeaders()` | `app-formio-renderer`, `app-table` |
| `normalizeRemoteDomain()` | `app-formio-renderer`, `app-table` |
| `normalizeRemoteSelectResponse()` | `app-formio-renderer`, `app-table` |

**Impact**: Duplicate ~10-15 lines in ~6 files each

**Refactor**: Create `core/domain-normalize.ts` for formio/table-specific patterns

---

## 🎯 REFACTORING PLAN

### Phase 1: Utility Centralization (Immediate)

**File created**: `/app/core/utils.ts`

**Import in all services**:
```ts
import { RecordCheck, JsonHelpers, StringHelpers } from './utils'

interface MyService extends RecordCheck, JsonHelpers, StringHelpers { ... }
```

**Extract functions**:
```ts
// core/utils.ts
export const isRecordCheck = isRecord      // used in: ozon-api, runtime-config, main-manager, app-manager, app-action, app-table, formio-builder-host
export const readFirstString = readFirstString   // used in: runtime-config, app-manager, app-action, app-table, app-formio-builder

export const jsonHelpers = {
  parseJsonOrText,
  parseNonNegativeInt,
  parseNdjsonLine,
  extractRecord,
  isRecord,
  stringifyDetail,
}

export const stringHelpers = {
  normalizeUrl,
  normalizeEndpointPath,
  extractOrigin,
  toBooleanFlag,
  toOptionalBooleanFlag,
  pickFirstString,
}
```

**Import in each file**:
- `ozon-api.service.ts`: `import { ... } from './core/utils'`
- `runtime-config.service.ts`: same
- `main-manager.service.ts`: same
- `app-manager.service.ts`: same
- `app-action-manager.service.ts`: same
- `app-table-manager.service.ts`: same
- `app-formio-builder.service.ts`: same
- `formio/ozon-form-builder-host.component.ts`: same

---

### Phase 2: URL Helpers (Next)

**File created**: `/app/core/url.service.ts`

**Extract functions**:
```ts
// core/url.service.ts
export const buildEndpointUrl = (cfg: RuntimeConfig, path: string): string
export const resolveFollowUpUrl = (currentUrl: string, location: string): string
export const normalizeAbsoluteHttpUrl = (value: string): string
export const normalizeBackendUrl = (value: string): string
export const normalizeSiteUrl = (value: string): string
```

**Use cases**:
- `ozon-api.service.ts`: `buildEndpointUrl()` replaces `resolveApiUrl()`, `buildEndpointUrl()`, `pathFromAbsoluteUrl()`
- `runtime-config.service.ts`: all URLs normalized in `updateConfig()` and `normalizeBackendUrl()`
- `app-action-manager.service.ts`: `normalizeRunnableMenuPath()`, `resolvePath()` use `normalizeEndpointPath()`

---

### Phase 3: Domain-Specific Normalize (Later)

**File created**: `/app/core/domain-normalize.ts`

**Pattern types**:
- Form normalization (`normalizeFormTableComponents`, etc.)
- Table normalization (`normalizeTableColumnsPayload`, etc.)
- Action normalization (`normalizeActionMenuCards`, etc.)

**Reason**: These have different validation rules, not suitable for shared utilities (yet)

---

### Phase 4: Cleanup `app.component.ts`

**Goal**: Reduce from 224 lines to ~150

**Remove**:
- `isRecord` wrapper → use exported
- `readFirstString` wrapper → use exported
- `normalizeUrl` wrapper → use imported

**Keep**:
- All getters for public API (performance concern)
- All `on` handlers that delegate to services

---

## ⚠️ RISK ASSESSMENT

| Risk | Impact | Mitigation |
|--- |--- |---|
| Breaking changes (import removed methods) | Medium | Add type exports, test imports in Phase 1 |
| `JSON.parse` errors silently | Medium | Add tests for `parseJsonOrText()` edge cases |
| URL normalization edge cases | High | Test with http:// vs https://, empty strings |
| `isRecord` type safety | Low | TypeScript already enforces `v is Record` |

---

## 🧪 TEST STRATEGY

**Write**:
1. `utils.spec.ts` in `core/utils.ts` → test all exported functions
2. `url.service.spec.ts` in `core/url.service.ts` → test URL normalization
3. Integration tests for `isRecord`, `normalizeEndpointPath` in each service

**Coverage goal**:
- `utils.ts`: 100% function coverage
- At least 5 test cases per public function
- Test edge cases: empty string, `undefined`, `null`

---

## 📝 SUMMARY

| Category | Count | Files |
|--- |--- |--- |
| Exact duplicate | 6 patterns | 18 files |
| Similar duplicate | 10 patterns | 20 files |
| Total `isRecord` calls | 80+ | 6 files |
| Total `readFirstString` calls | 60+ | 5 files |
| Total JSON.parse (manual) | 35+ | 3 files |
| Total URL normalize calls | 50+ | 5 files |

---

**Next step**: Create `core/url.service.ts` and `core/domain-normalize.ts` (Phase 1 completion), then import in all services.

---

*This report has been corrected from previous versions. It does not reference `app-component-renderer` or outdated file counts.*
