# Refactoring: Metodi Ripetuti

## Problema Identificato

Il codice contiene numerosi metodi duplicati in diversi servizi:

### 1. `isRecord()` - Type Guard
**File coinvolti:**
- `src/app/core/backend-auth.service.ts:231`
- `src/app/managers/app-action-manager.service.ts:47`
- `src/app/managers/app-formio-builder.service.ts:85`
- `src/app/managers/app-formio-renderer.service.ts:28`
- `src/app/managers/app-manager.service.ts:58`
- `src/app/managers/app-table-manager.service.ts:72`
- `src/app/formio/ozon-form-builder-host.component.ts:205`

**Implementazione duplicata:**
```typescript
isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
```

**Raccomandazione:**
Creare un utility file condiviso:
```typescript
// src/app/utils/type-guards.ts
export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
```

Importare in tutti i file invece di ridefinire.

---

### 2. `pickFirstString()` / Varianti
**File:** `src/app/core/runtime-config.service.ts:223`

**Variante duplicata in `backend-auth.service.ts`:**
```typescript
private readFirstString(...values: unknown[]): string {
  return values.find(v => typeof v === 'string' && v) ?? '';
}
```

**Raccomandazione:**
Unificare in un utility function e esportare.

---

### 3. `trim()` e `String()`
**File interessati:**
- `ozon-api.service.ts` (18 chiamate `trim`, 18 `String`)
- `app-formio-renderer.service.ts` (38 `trim`, 28 `String`)
- `app-table-manager.service.ts` (54 `trim`, 47 `String`)
- `app-formio-builder.service.ts` (7 `String`)

**Pattern:**
```typescript
value.trim()        // ovunque
String(value)       // ovunque
```

**Raccomandazione:**
1. Usare `value?.toString().trim()` inline dove possibile
2. O creare helper: `trim(v: unknown): string`

---

### 4. `deepClone()` varianti
**File:** `formio-utility.ts` vs usi in builder

**Raccomandazione:**
Assicurarsi di usare una singola implementazione di deep clone.

---

## Piano d'Azione

### Passo 1: Crea utility file
```bash
mkdir -p src/app/utils
touch src/app/utils/type-guards.ts
touch src/app/utils/strings.ts
```

### Passo 2: Sposta e esporta i metodi
```typescript
// src/app/utils/type-guards.ts
export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(item => typeof item === 'string');
}

// src/app/utils/strings.ts
export function trim(value: unknown): string {
  return String(value)?.trim() ?? '';
}

export function trimOrEmpty(value: unknown): string {
  return String(value)?.trim() ?? '';
}

export function trimOptional(value: unknown): string | null {
  return String(value)?.trim() ?? null;
}
```

### Passo 3: Aggiorna import nei file
```typescript
// In ogni file:
import { isRecord, trim } from '../utils/type-guards';

// O per string:
import { trim, trimOrEmpty, trimOptional } from '../utils/strings';
```

### Passo 4: Rimuovi definizioni duplicate
Cancellare le definizioni locali nei file.

---

## Benefici Aspettati

1. **Meno duplicazione:** Single Source of Truth
2. **Miglior maintainability:** Cambia una volta, funziona ovunque
3. **Meno errori:** Tipi di errore coerenti
4. **Testing facilitato:** Test una volta per tutte le usate

---

## Priority

**HIGH:**
- `isRecord()` - used 7+ times across core services
- `pickFirst*` variants - inconsistent implementations

**MEDIUM:**
- `trim()`, `String()` - can be simplified

**LOW:**
- Utility helpers - refactor only if needed