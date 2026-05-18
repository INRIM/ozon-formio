export interface TableColumn {
    field: string;
    title: string;
}

export interface TableRow extends Record<string, unknown> {
    __rowid: number;
    __rec_name: string;
}

export type TableSortDirection = 'asc' | 'desc';

export interface ListSortChange {
    field: string;
    direction: TableSortDirection;
}

export interface ListPageChange {
    pageIndex: number;
    pageSize: number;
}

export interface ListRowReorderChange {
    previousIndex: number;
    currentIndex: number;
}

export interface SelectValueOption {
    label: string;
    value: unknown;
    data?: unknown;
}

export interface QueryBuilderFieldConfig {
    name: string;
    type: string;
}

export interface QueryBuilderConfig {
    fields: Record<string, QueryBuilderFieldConfig>;
}

export interface Rule {
    field?: string;
    operator?: string;
    value?: unknown;
}

export interface RuleSet {
    condition?: string;
    rules: Array<Rule | RuleSet>;
}

export type QueryMode = 'builder' | 'json';

export interface MenuActionDescriptor {
    model: string;
    rec_name: string;
    title: string;
    action_type: 'save' | 'copy' | 'delete' | 'window';
    action_root_path: string;
    button_icon: string;
    builder_enabled: boolean;
    mode?: 'form' | 'list';
    content?: string;
    number?: number;
}

export interface MenuButton {
    model: string;
    key: string;
    type: 'button';
    label: string;
    leftIcon: string;
    authtoken: string;
    req_id: string;
    btn_action_type: 'post' | false | undefined;
    action_type: string;
    url_action: string;
    builder: boolean;
    mode?: string;
    content?: string;
    number?: number;
    menu_group?: string;
    menu_type?: string;
    is_admin?: boolean;
    next_action_path?: string;
}

export interface MenuCard {
    model: string;
    group_id: string;
    title: string;
    buttons: MenuButton[];
    menu_type?: string;
    is_admin?: boolean;
    parent?: string;
}

export interface MenuDrillDownGroup {
    group_id: string;
    title: string;
    buttons: MenuButton[];
}

export type ExportFileType = 'xls' | 'csv' | 'json';
export type ImportTemplateFormat = 'excel' | 'json';

export interface ListExportConfig {
    visible: boolean;
    model: string;
    searchModel: string;
    parent: string;
    hideAll: boolean;
    xlsFilteredLabel: string;
    csvFilteredLabel: string;
    jsonFilteredLabel: string;
}

export interface ListImportConfig {
    visible: boolean;
    model: string;
    title: string;
}

export interface ListSearchSessionContext {
    searchModel: string;
    dataModel: string;
    actionName: string;
    baseQuery: Record<string, unknown>;
    currentQuery: Record<string, unknown>;
    order: string;
    totalCount: number;
    fastSearchActive: boolean;
    fastSearchFormModel: string;
    fastSearchDataModel: string;
    fastSearchQueryFields: Record<string, unknown>[];
    fastSearchFormData: Record<string, unknown>;
}

export interface ImportColumnDescriptor {
    name: string;
}

export interface ImportPreviewRow extends Record<string, unknown> {}

export interface ImportSubmissionPayload {
    fields: ImportColumnDescriptor[];
    data: ImportPreviewRow[];
    delete_before?: boolean;
}

export type ThemeMode = 'light' | 'dark';
export type AppViewMode = 'dashboard' | 'list' | 'form';

/** Action button supplied by the backend in `context_actions`. */
export interface ContextAction {
    rec_name: string;
    action_type: string;
    label: string;
    button_icon: string;
    modal: boolean;
    /** Empty array → all contexts. Otherwise list of contexts: "form", "list". */
    context_button_mode: string[];
    url_action: string;
}
