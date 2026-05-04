export interface TableColumn {
    field: string;
    title: string;
}

export interface TableRow extends Record<string, unknown> {
    __rowid: number;
    __rec_name: string;
}

export interface SelectValueOption {
    label: string;
    value: unknown;
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

export type ThemeMode = 'light' | 'dark';
export type AppViewMode = 'dashboard' | 'list' | 'form';
