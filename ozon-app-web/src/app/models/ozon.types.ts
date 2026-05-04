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
}

export interface ListRequestPayload {
  query: Record<string, unknown> | string;
  skip: number;
  limit: number;
  order?: unknown;
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

export type ResponseMode =
  | 'form'
  | 'list'
  | 'list_stream'
  | 'layout'
  | 'menu'
  | 'card'
  | 'redirect'
  | 'action'
  | string;

export interface ResponseObjectData {
  mode: ResponseMode;
  data: unknown;
  readable?: boolean;
  editable?: boolean;
  can_create?: boolean;
  model?: string;
  query?: Record<string, unknown>;
  obfucated_fields?: string[];
  editable_fields?: string[];
  schema?: unknown;
  rec_name?: string;
  fields?: Record<string, unknown>;
  columns?: unknown;
  filter_kyes?: Record<string, string>;
  batch_size?: number;
  total_count?: number;
}

export interface ResponseObject {
  content: ResponseObjectData;
  fail?: boolean;
  message?: string;
}

export type ActionRouterResponse = Partial<ResponseObjectData> & {
  mode?: string;
  data?: unknown;
  model?: string;
  rec_name?: string;
  query?: unknown;
  schema?: unknown;
  fields?: unknown;
  columns?: unknown;
  total_count?: unknown;
  fail?: boolean;
  message?: string;
  content?: unknown;
};

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
