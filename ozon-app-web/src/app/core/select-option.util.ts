import { SelectValueOption } from '../models/app.types';

type UnknownRecord = Record<string, unknown>;

const VALUE_KEYS = ['value', 'id', '_id', 'code', 'key', 'k', 'name', 'rec_name'] as const;
const LABEL_KEYS = ['label', 'title', 'name', 'rec_name', 'description', 'v'] as const;

function isRecord(value: unknown): value is UnknownRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | null {
    return isRecord(value) ? value : null;
}

function toDisplayValue(value: unknown): string {
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function firstDefined(source: UnknownRecord | null, keys: readonly string[]): unknown {
    if (!source) return undefined;
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined) return value;
    }
    return undefined;
}

function collectOptionSources(entry: UnknownRecord): UnknownRecord[] {
    const sources = [
        entry,
        asRecord(entry['data']),
        asRecord(entry['data_value']),
        asRecord(asRecord(entry['data'])?.['data_value'])
    ].filter((source): source is UnknownRecord => Boolean(source));

    const seen = new Set<UnknownRecord>();
    return sources.filter(source => {
        if (seen.has(source)) return false;
        seen.add(source);
        return true;
    });
}

function extractOptionPayload(entry: UnknownRecord): UnknownRecord {
    const nested = asRecord(entry['data']);
    const nestedDataValue = asRecord(entry['data_value']);
    if (!nested) return entry;
    if (!nestedDataValue || Object.prototype.hasOwnProperty.call(nested, 'data_value')) return nested;
    return { ...nested, data_value: nestedDataValue };
}

export function selectOptionPrimitiveValue(value: unknown): unknown {
    if (!isRecord(value)) return value;
    const sources = collectOptionSources(value);
    for (const source of sources) {
        const primitive = firstDefined(source, VALUE_KEYS);
        if (primitive !== undefined) return primitive;
    }
    return value;
}

export function toSelectValueOption(value: unknown): SelectValueOption | null {
    if (value == null) return null;
    if (!isRecord(value)) return { label: toDisplayValue(value), value };

    const sources = collectOptionSources(value);
    let optionValue: unknown = undefined;
    for (const source of sources) {
        optionValue = firstDefined(source, VALUE_KEYS);
        if (optionValue !== undefined) break;
    }
    if (optionValue === undefined) return null;

    let optionLabel: unknown = undefined;
    for (const source of sources) {
        optionLabel = firstDefined(source, LABEL_KEYS);
        if (optionLabel !== undefined) break;
    }

    return {
        label: toDisplayValue(optionLabel ?? optionValue),
        value: optionValue,
        data: extractOptionPayload(value)
    };
}
