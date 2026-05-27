import { SelectValueOption } from '../models/app.types';

type UnknownRecord = Record<string, unknown>;

export interface SelectOptionMappingConfig {
    valuePaths?: readonly string[];
    labelPaths?: readonly string[];
    aliasValuePaths?: readonly string[];
}

const DEFAULT_VALUE_PATHS = ['value', 'rec_name', 'id', '_id', 'code', 'key', 'k', 'name'] as const;
const DEFAULT_LABEL_PATHS = ['label', 'title', 'full_name', 'name', 'rec_name', 'description', 'v'] as const;
const SIMPLE_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

function readPath(source: UnknownRecord | null, path: string): unknown {
    if (!source) return undefined;
    const normalized = String(path ?? '').trim();
    if (!normalized) return undefined;
    if (!normalized.includes('.')) return source[normalized];

    let current: unknown = source;
    const segments = normalized.split('.').map(segment => segment.trim()).filter(Boolean);
    for (const segment of segments) {
        if (!isRecord(current)) return undefined;
        current = current[segment];
        if (current === undefined) return undefined;
    }
    return current;
}

function uniquePaths(preferred: readonly string[] = [], defaults: readonly string[] = []): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();
    [...preferred, ...defaults].forEach((entry) => {
        const normalized = String(entry ?? '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        paths.push(normalized);
    });
    return paths;
}

function firstDefined(source: UnknownRecord | null, paths: readonly string[]): unknown {
    if (!source) return undefined;
    for (const path of paths) {
        const value = readPath(source, path);
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

function isAliasablePrimitive(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function applyOptionAliases(
    option: SelectValueOption & Record<string, unknown>,
    value: unknown,
    aliasPaths: readonly string[]
): void {
    if (!isAliasablePrimitive(value)) return;
    const aliases = uniquePaths(aliasPaths, ['rec_name', 'id', '_id', 'value']);
    aliases.forEach((path) => {
        if (!SIMPLE_PATH_PATTERN.test(path)) return;
        option[path] = value;
    });
}

export function selectOptionPrimitiveValue(value: unknown, config: SelectOptionMappingConfig = {}): unknown {
    if (!isRecord(value)) return value;
    const valuePaths = uniquePaths(config.valuePaths, DEFAULT_VALUE_PATHS);
    const sources = collectOptionSources(value);
    for (const source of sources) {
        const primitive = firstDefined(source, valuePaths);
        if (primitive !== undefined) return primitive;
    }
    return value;
}

export function toSelectValueOption(value: unknown, config: SelectOptionMappingConfig = {}): SelectValueOption | null {
    if (value == null) return null;
    if (!isRecord(value)) return { label: toDisplayValue(value), value };

    const valuePaths = uniquePaths(config.valuePaths, DEFAULT_VALUE_PATHS);
    const labelPaths = uniquePaths(config.labelPaths, DEFAULT_LABEL_PATHS);
    const sources = collectOptionSources(value);
    let optionValue: unknown = undefined;
    for (const source of sources) {
        optionValue = firstDefined(source, valuePaths);
        if (optionValue !== undefined) break;
    }
    if (optionValue === undefined) return null;

    let optionLabel: unknown = undefined;
    for (const source of sources) {
        optionLabel = firstDefined(source, labelPaths);
        if (optionLabel !== undefined) break;
    }

    const option: SelectValueOption & Record<string, unknown> = {
        label: toDisplayValue(optionLabel ?? optionValue),
        value: optionValue,
        data: extractOptionPayload(value)
    };
    applyOptionAliases(option, optionValue, config.aliasValuePaths ?? config.valuePaths ?? []);
    return option;
}
