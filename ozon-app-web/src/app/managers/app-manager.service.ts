import { Injectable } from '@angular/core';
import { RuntimeAuthMode, ResponseObjectData } from '../models/ozon.types';
import { OzonApiService } from '../core/ozon-api.service';
import { BackendAuthService } from '../core/backend-auth.service';
import { MainManagerService } from '../core/main-manager.service';
import { RuntimeConfigService } from '../core/runtime-config.service';
import { AppViewMode, FormNotification, MenuButton, MenuCard } from '../models/app.types';

@Injectable()
export class AppManagerService {
    backendUrl = '';
    baseToken = '';
    authMode: RuntimeAuthMode = 'keycloak';

    models: string[] = [];
    selectedModel = '';

    statusText = '';
    statusError = false;
    serverErrorRetryVisible = false;

    dashboardMenu: MenuCard[] = [];
    dashboardCards: MenuCard[] = [];
    contextualActions: MenuButton[] = [];
    layoutName = '';
    layoutSchema: Record<string, unknown> | null = null;
    appModuleName: string;
    appVersion = '';
    appLogoUrl = '';
    currentUserName = 'Utente';
    userAvatarUrl = '';
    isAdminUser = false;
    isTechUser = false;
    builderFeatureEnabled = false;
    viewMode: AppViewMode = 'dashboard';
    builderEnabled = false;
    openedNavMenuGroup = '';
    userMenuOpen = false;
    activeDashboardGroup = '';
    backendSessionReady = false;
    actionMenuIntegrated = false;
    actionRouterActive = false;

    sessionLocale = 'it';
    sessionTimezone = '';
    sessionAppSettings: Record<string, unknown> = {};
    sessionUser: Record<string, unknown> = {};
    sessionRecord: Record<string, unknown> = {};
    formioRenderOptions: Record<string, unknown> = { evalContext: { user: {}, is_admin: false, is_tech: false, session: { user: {} } } };
    userNameSource: 'default' | 'session' | 'layout' = 'default';
    initialBuilderPreference = false;

    private readonly BUILDER_STORAGE_KEY = 'ozon-app-web.builder';
    private readonly NOTIFICATIONS_STORAGE_KEY = 'ozon-app-web.form-notifications';

    formNotifications: FormNotification[] = [];

    constructor(
        private readonly api: OzonApiService,
        private readonly backendAuth: BackendAuthService,
        private readonly mainManager: MainManagerService,
        runtimeConfig: RuntimeConfigService
    ) {
        this.appModuleName = runtimeConfig.getConfig().appModuleName;
    }

    setStatus(m: string, e: boolean): void { this.statusText = m; this.statusError = e; }

    setFormNotifications(notifications: FormNotification[]): void {
        this.formNotifications = notifications;
        if (typeof window === 'undefined') return;
        if (notifications.length) {
            window.localStorage.setItem(this.NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
        } else {
            window.localStorage.removeItem(this.NOTIFICATIONS_STORAGE_KEY);
        }
    }

    clearFormNotifications(): void { this.setFormNotifications([]); }

    restoreFormNotifications(): void {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(this.NOTIFICATIONS_STORAGE_KEY);
            this.formNotifications = raw ? (JSON.parse(raw) as FormNotification[]) : [];
        } catch { this.formNotifications = []; }
    }
    errorMessage(e: unknown): string { return e instanceof Error ? e.message : String(e); }
    isRecord(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }

    applyRuntime(config: { backendUrl: string; baseToken: string; authMode: RuntimeAuthMode; appLogoUrl?: string }): void {
        this.backendUrl = config.backendUrl;
        this.baseToken = config.baseToken;
        this.authMode = config.authMode;
        if (config.appLogoUrl) this.appLogoUrl = this.resolveBrandAssetUrl(config.appLogoUrl);
    }

    initializeBuilderPreference(): void {
        const fromQuery = this.readBuilderFromQuery();
        const fromStorage = this.readBuilderFromStorage();
        this.initialBuilderPreference = fromQuery ?? fromStorage ?? false;
        this.setBuilderEnabled(this.initialBuilderPreference, false);
    }

    setBuilderEnabled(enabled: boolean, persist: boolean): void {
        const canEnable = this.builderFeatureEnabled;
        this.builderEnabled = canEnable ? Boolean(enabled) : false;
        if (!this.builderEnabled) {
            this.openedNavMenuGroup = '';
        }
        if (persist && typeof window !== 'undefined') {
            window.localStorage.setItem(this.BUILDER_STORAGE_KEY, this.builderEnabled ? '1' : '0');
        }
    }

    private readBuilderFromQuery(): boolean | null {
        if (typeof window === 'undefined') return null;
        const value = new URLSearchParams(window.location.search).get('builder');
        if (value == null) return null;
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return null;
    }

    private readBuilderFromStorage(): boolean | null {
        if (typeof window === 'undefined') return null;
        const value = window.localStorage.getItem(this.BUILDER_STORAGE_KEY);
        if (value == null) return null;
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        return null;
    }

    async loadSession(preloadedPayload?: unknown): Promise<void> {
        try {
            const payload = preloadedPayload ?? await this.api.getSession();
            const session = this.extractSessionRecord(payload);
            if (!session) return;

            this.sessionLocale = this.resolveSessionLocale(session);
            this.sessionTimezone = this.resolveSessionTimezone(session);
            const sessionUserName = this.resolveSessionUserName(session);
            if (sessionUserName) {
                this.currentUserName = sessionUserName;
                this.userNameSource = 'session';
            }
            const sessionUser = this.isRecord(session['user']) ? session['user'] : {};
            const sessionUserData = this.isRecord(sessionUser['user_data']) ? sessionUser['user_data'] : {};
            this.userAvatarUrl = this.readFirstString(sessionUserData['avatar_url'], this.userAvatarUrl);
            this.isAdminUser = this.resolveSessionAdminFlag(session);
            this.isTechUser = this.resolveSessionTechFlag(session);
            this.builderFeatureEnabled = this.isAdminUser || this.isTechUser;
            this.sessionAppSettings = this.extractSessionSettings(session);
            this.sessionRecord = { ...session };
            this.sessionUser = this.buildSessionUserContext(session);
            this.refreshFormioRenderOptions();
            this.applySessionSettings(this.sessionAppSettings);
            this.setBuilderEnabled(this.initialBuilderPreference, false);
        } catch {
            this.sessionLocale = 'it';
            this.sessionTimezone = '';
            this.isAdminUser = false;
            this.isTechUser = false;
            this.builderFeatureEnabled = false;
            this.sessionUser = {};
            this.sessionRecord = {};
            this.refreshFormioRenderOptions();
            this.setBuilderEnabled(false, false);
        }
    }

    login(): boolean {
        if (typeof window === 'undefined') return false;
        const loginUrl = this.backendAuth.getLoginUrl();
        if (!loginUrl) return false;
        window.location.href = loginUrl;
        return true;
    }

    hardReloadToUrl(url: string): { reloaded: boolean; blocked: boolean; targetUrl: string } {
        return this.mainManager.hardReloadToUrl(url);
    }

    getLoginUrl(): string {
        return this.backendAuth.getLoginUrl();
    }

    logout(): { redirectUrl: string } {
        return this.backendAuth.logout();
    }

    async bootstrap(): Promise<{ authenticated: boolean; serverError: boolean }> {
        return this.backendAuth.bootstrap();
    }

    consumeSessionPayload(): unknown {
        return this.backendAuth.consumeSessionPayload();
    }

    resetClientState(statusMessage: string): void {
        this.baseToken = '';
        this.dashboardMenu = [];
        this.dashboardCards = [];
        this.contextualActions = [];
        this.selectedModel = '';
        this.currentUserName = 'Utente';
        this.userAvatarUrl = '';
        this.sessionLocale = 'it';
        this.sessionTimezone = '';
        this.isAdminUser = false;
        this.isTechUser = false;
        this.builderFeatureEnabled = false;
        this.sessionUser = {};
        this.sessionRecord = {};
        this.refreshFormioRenderOptions();
        this.userNameSource = 'default';
        this.viewMode = 'dashboard';
        this.actionMenuIntegrated = false;
        this.actionRouterActive = false;
        this.userMenuOpen = false;
        this.backendSessionReady = false;
        this.openedNavMenuGroup = '';
        this.clearFormNotifications();
        this.setStatus(statusMessage, false);
    }

    toggleUserMenu(): void {
        this.userMenuOpen = !this.userMenuOpen;
    }

    openTopMenu(card: MenuCard): void {
        if (!card?.group_id) return;
        this.activeDashboardGroup = card.group_id;
        this.openedNavMenuGroup = this.openedNavMenuGroup === card.group_id ? '' : card.group_id;
    }

    closeTopMenu(): void {
        this.openedNavMenuGroup = '';
    }

    syncActiveDashboardGroup(topMenuCards: MenuCard[]): void {
        if (!topMenuCards.length) {
            this.activeDashboardGroup = '';
            this.openedNavMenuGroup = '';
            return;
        }
        if (!topMenuCards.some(card => card.group_id === this.activeDashboardGroup)) {
            this.activeDashboardGroup = topMenuCards[0].group_id;
        }
        if (this.openedNavMenuGroup && !topMenuCards.some(card => card.group_id === this.openedNavMenuGroup)) {
            this.openedNavMenuGroup = '';
        }
    }

    applyLayoutResponse(
        content: ResponseObjectData,
        normalizeActionMenuCards: (d: unknown) => MenuCard[],
        cloneSchema: (s: Record<string, unknown>) => Record<string, unknown>,
        topMenuCards: MenuCard[]
    ): void {
        if (!content || content.mode !== 'layout') {
            throw new Error('Risposta layout non valida');
        }
        this.actionRouterActive = true;
        const data = this.isRecord(content.data) ? content.data : {};
        const schema = this.isRecord(data['schema']) ? data['schema'] : null;
        this.layoutName = this.readFirstString(data['layout'], schema?.['rec_name'], this.layoutName || 'default') || 'default';
        this.layoutSchema = schema ? cloneSchema(schema) : null;

        const layoutSettings = this.isRecord(data['settings']) ? data['settings'] : {};
        const settings = { ...this.sessionAppSettings, ...layoutSettings };
        const moduleName = this.readFirstString(
            settings['module_name'],
            settings['module_label'],
            settings['moduleName'],
            this.appModuleName
        );
        this.appModuleName = moduleName || this.appModuleName;
        this.appVersion = this.readFirstString(settings['app_version'], settings['version'], this.appVersion);
        const logoRaw = this.readFirstString(settings['logo'], settings['logo_img_url'], settings['logo_img'], settings['logo_url'], this.appLogoUrl);
        this.appLogoUrl = this.resolveBrandAssetUrl(logoRaw);

        const runtimeUser = this.readFirstString(settings['user_name'], settings['username'], settings['user']);
        if (runtimeUser && this.userNameSource === 'default') {
            this.currentUserName = runtimeUser;
            this.userNameSource = 'layout';
        }

        const menus = normalizeActionMenuCards(data['menu']);
        this.dashboardMenu = menus;
        this.actionMenuIntegrated = menus.length > 0;
        this.syncActiveDashboardGroup(topMenuCards);
    }

    applyMenuResponse(
        content: ResponseObjectData,
        normalizeActionMenuCards: (d: unknown) => MenuCard[],
        topMenuCards: MenuCard[]
    ): void {
        if (!content || content.mode !== 'menu') {
            throw new Error('Risposta menu non valida');
        }
        this.actionRouterActive = true;
        this.dashboardMenu = normalizeActionMenuCards(content.data);
        this.syncActiveDashboardGroup(topMenuCards);
        this.actionMenuIntegrated = this.dashboardMenu.length > 0;
    }

    applyDashboardResponse(
        content: ResponseObjectData,
        normalizeActionCards: (d: unknown) => MenuCard[]
    ): void {
        if (!content || content.mode !== 'card') {
            throw new Error('Risposta dashboard non valida');
        }
        this.actionRouterActive = true;
        this.dashboardCards = normalizeActionCards(content.data);
    }

    applySessionSettings(settings: Record<string, unknown>): void {
        if (!settings || !Object.keys(settings).length) return;
        const moduleName = this.readFirstString(settings['module_name'], settings['module_label'], this.appModuleName);
        if (moduleName) this.appModuleName = moduleName;
        const version = this.readFirstString(settings['app_version'], settings['version'], this.appVersion);
        if (version) this.appVersion = version;
        const logo = this.readFirstString(settings['logo'], settings['logo_img_url'], settings['logo_img'], settings['logo_url']);
        if (logo) this.appLogoUrl = this.resolveBrandAssetUrl(logo);
    }

    resolveBrandAssetUrl(raw: string): string {
        const value = String(raw ?? '').trim();
        if (!value) return '';
        if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:')) return value;
        const normalized = `/${value.replace(/^\/+/, '')}`;
        if (normalized.startsWith('/api/')) return normalized;
        if (this.backendUrl && /^https?:\/\//i.test(this.backendUrl)) {
            try {
                return new URL(normalized, this.backendUrl).toString();
            } catch {
                return normalized;
            }
        }
        return `/api${normalized}`;
    }

    readFirstString(...candidates: unknown[]): string {
        for (const entry of candidates) {
            if (typeof entry === 'string' && entry.trim()) return entry.trim();
        }
        return '';
    }

    toOptionalBooleanFlag(value: unknown): boolean | null {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (!normalized) return null;
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
            return null;
        }
        return null;
    }

    toBooleanFlag(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
            if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
        }
        return Boolean(value);
    }

    private resolveSessionUserName(session: Record<string, unknown>): string {
        const user = this.isRecord(session['user']) ? session['user'] : {};
        const profile = this.isRecord(session['profile']) ? session['profile'] : {};
        return this.readFirstString(
            session['name'], session['full_name'], session['display_name'], session['uid'], session['user_name'],
            user['name'], user['full_name'], user['display_name'], user['uid'], user['user_name'],
            profile['name'], profile['full_name'], profile['display_name'], profile['username']
        );
    }

    private resolveSessionAdminFlag(session: Record<string, unknown>): boolean {
        if (this.toOptionalBooleanFlag(session['is_admin']) === true) return true;
        const topGroups = Array.isArray(session['groups']) ? session['groups'] as unknown[] : [];
        const userObj = this.isRecord(session['user']) ? session['user'] : {};
        const userGroups = Array.isArray(userObj['groups']) ? userObj['groups'] as unknown[] : [];
        const allGroups = [...topGroups, ...userGroups];
        return allGroups.some(g => {
            const name = typeof g === 'string' ? g : (this.isRecord(g) ? String((g as Record<string, unknown>)['name'] ?? '') : '');
            return name === 'Admins' || name === '/Admins';
        });
    }

    private resolveSessionTechFlag(session: Record<string, unknown>): boolean {
        if (this.toOptionalBooleanFlag(session['is_tech']) === true) return true;
        const userObj = this.isRecord(session['user']) ? session['user'] : {};
        if (this.toOptionalBooleanFlag(userObj['is_tech']) === true) return true;
        const userData = this.isRecord(userObj['user_data']) ? userObj['user_data'] : {};
        return this.toOptionalBooleanFlag(userData['is_tech']) === true;
    }

    private resolveSessionLocale(session: Record<string, unknown>): string {
        const user = this.isRecord(session['user']) ? session['user'] : {};
        const profile = this.isRecord(session['profile']) ? session['profile'] : {};
        const settings = this.extractSessionSettings(session);
        const locale = this.readFirstString(
            session['locale'], session['lang'], session['language'], session['user_locale'],
            user['locale'], user['lang'], user['language'], user['user_locale'],
            profile['locale'], profile['lang'], profile['language'], profile['user_locale'],
            settings['locale'], settings['lang'], settings['language']
        );
        return this.normalizeSessionLocale(locale);
    }

    private resolveSessionTimezone(session: Record<string, unknown>): string {
        const user = this.isRecord(session['user']) ? session['user'] : {};
        const profile = this.isRecord(session['profile']) ? session['profile'] : {};
        const settings = this.extractSessionSettings(session);
        const timezone = this.readFirstString(
            session['tz'], session['timezone'],
            user['tz'], user['timezone'],
            profile['tz'], profile['timezone'],
            settings['tz'], settings['timezone']
        );
        return this.normalizeSessionTimezone(timezone);
    }

    private normalizeSessionLocale(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) return 'it';
        const normalized = raw.replace(/_/g, '-');
        try {
            const [canonical] = Intl.getCanonicalLocales(normalized);
            return canonical || 'it';
        } catch {
            return 'it';
        }
    }

    private normalizeSessionTimezone(value: unknown): string {
        const raw = String(value ?? '').trim();
        if (!raw) return '';
        try {
            new Intl.DateTimeFormat('it', { timeZone: raw }).format(new Date());
            return raw;
        } catch {
            return '';
        }
    }

    private extractSessionSettings(session: Record<string, unknown>): Record<string, unknown> {
        const app = this.isRecord(session['app']) ? session['app'] : {};
        const settings = this.isRecord(app['settings']) ? app['settings'] : {};
        const settingsDataValue = this.isRecord(settings['data_value']) ? settings['data_value'] : {};
        return { ...settings, ...settingsDataValue };
    }

    private buildSessionUserContext(session: Record<string, unknown>): Record<string, unknown> {
        const sessionUser = this.isRecord(session['user']) ? session['user'] : {};
        const nestedUser = this.isRecord(sessionUser['user']) ? sessionUser['user'] : null;
        const user = nestedUser ? { ...nestedUser } : { ...sessionUser };
        const promotedKeys = [
            'uid', 'user_name', 'username', 'name', 'full_name', 'display_name',
            'divisione_code', 'allowed_users', 'groups', 'avatar', 'avatar_url', 'avartar_url',
            'is_tech',
            'locale', 'lang', 'language', 'user_locale',
            'tz', 'timezone'
        ];
        for (const key of promotedKeys) {
            if (Object.prototype.hasOwnProperty.call(user, key)) continue;
            if (Object.prototype.hasOwnProperty.call(sessionUser, key)) {
                user[key] = sessionUser[key];
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(session, key)) continue;
            user[key] = session[key];
        }
        return user;
    }

    private refreshFormioRenderOptions(): void {
        const user = { ...this.sessionUser };
        if (!Object.prototype.hasOwnProperty.call(user, 'is_admin')) user['is_admin'] = this.isAdminUser;
        if (!Object.prototype.hasOwnProperty.call(user, 'is_tech')) user['is_tech'] = this.isTechUser;
        const session: Record<string, unknown> = { ...this.sessionRecord };
        if (!Object.prototype.hasOwnProperty.call(session, 'is_admin')) session['is_admin'] = this.isAdminUser;
        if (!Object.prototype.hasOwnProperty.call(session, 'is_tech')) session['is_tech'] = this.isTechUser;
        this.formioRenderOptions = { evalContext: { user, is_admin: this.isAdminUser, is_tech: this.isTechUser, session } };
    }

    private scoreSessionRecord(record: Record<string, unknown>): number {
        const user = this.isRecord(record['user']) ? record['user'] : {};
        const settings = this.extractSessionSettings(record);
        let score = 0;
        if (Object.keys(user).length) score += 3;
        if (this.resolveSessionUserName(record)) score += 3;
        if (this.resolveSessionAdminFlag(record)) score += 2;
        if (this.isRecord(record['app'])) score += 1;
        if (Object.keys(settings).length) score += 1;
        return score;
    }

    private extractSessionRecord(payload: unknown): Record<string, unknown> | null {
        let target: unknown = payload;
        for (let i = 0; i < 4; i += 1) {
            if (this.isRecord(target) && this.isRecord(target['content'])) {
                target = target['content']['data'] ?? target['content'];
                continue;
            }
            if (this.isRecord(target) && Array.isArray(target['data'])) {
                target = target['data'];
                continue;
            }
            break;
        }
        if (Array.isArray(target)) {
            const records = target.filter((entry): entry is Record<string, unknown> => this.isRecord(entry));
            if (!records.length) return null;
            records.sort((left, right) => this.scoreSessionRecord(right) - this.scoreSessionRecord(left));
            return records[0];
        }
        return this.isRecord(target) ? target : null;
    }
}
