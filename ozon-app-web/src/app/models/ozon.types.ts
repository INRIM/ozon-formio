export type RuntimeAuthMode = 'none' | 'keycloak';

export interface RuntimeConfig {
  backendUrl: string;
  siteUrl: string;
  allowedOrigins: string[];
  baseToken: string;
  useProxy: boolean;
  sessionCacheTtlMs: number;
  authMode: RuntimeAuthMode;
  authLoginPath: string;
  authLogoutPath: string;
  authRefreshPath: string;
  appCode: string;
}

export type ResponseMode = 'form' | 'list' | 'list_stream' | 'layout' | 'menu' | 'card' | 'redirect' | 'action' | string;

export interface ContextActionRaw {
  rec_name: string;
  action_type: string;
  label: string;
  button_icon: string;
  modal: boolean;
  context_button_mode: string | string[];
  url_action: string;
}

export interface ResponseObjectData {
  mode: ResponseMode;
  data: unknown;
  readable: boolean;
  editable: boolean;
  can_create: boolean;
  model: string;
  query: Record<string, unknown>;
  sort?: string;
  obfucated_fields: string[];
  editable_fields: string[];
  schema: unknown;
  rec_name: string;
  fields: Record<string, unknown>;
  columns: Record<string, string>;
  filter_kyes: Record<string, string>;
  batch_size: number;
  total_count: number;
  context_actions: ContextActionRaw[];
  title: string;
  next_action_url: string;
}

export interface ResponseObject {
  content: ResponseObjectData;
  fail: boolean;
  message: string;
}

export function requireResponseObject(payload: unknown): ResponseObject {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Invalid ResponseObject');
  const p = payload as Record<string, unknown>;
  if (!p['content'] || typeof p['content'] !== 'object' || Array.isArray(p['content']))
    throw new Error('Invalid ResponseObject');
  const c = p['content'] as Record<string, unknown>;
  if (typeof c['mode'] !== 'string' || !c['mode'])
    throw new Error('Invalid ResponseObject');
  return payload as ResponseObject;
}

export interface ListRequestPayload {
  query: Record<string, unknown> | string;
  skip: number;
  limit: number;
  order?: unknown;
}

export interface FastSearchPayload {
  query_fields: Record<string, unknown>[];
  query?: Record<string, unknown>;
  order?: string;
  skip?: number;
  limit?: number;
}

export interface FastSearchConfig {
  model?: string;
  schema: unknown;
  fast_serch_model?: string;
}

export interface ListStreamResult {
  count: number;
  totalCount: number;
  contentType: string;
  order: string;
  skip: string;
  limit: string;
  columnsRaw: string;
  columns: unknown | null;
}

export interface ApiErrorPayload {
  detail?: unknown;
  message?: string;
  [key: string]: unknown;
}

export interface RemoteSelectRequestPayload {
  key?: string;
  curr_model?: string;
  data?: {
    url?: string;
    pathValue?: string;
    path_value?: string;
    headers?: Array<{ key: string; value: string }>;
    headerKey?: string;
    header_value_key?: string;
    header_key?: string;
    headerValueKey?: string;
    [key: string]: unknown;
  };
  properties?: {
    model?: string;
    domain?: Record<string, unknown>;
    compute_label?: string;
    src?: string;
    label?: string;
    id?: string;
    [key: string]: unknown;
  };
  url?: string;
  path_value?: string;
  header_key?: string;
  header_value_key?: string;
  [key: string]: unknown;
}
