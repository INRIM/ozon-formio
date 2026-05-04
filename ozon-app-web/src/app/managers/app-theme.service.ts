import { Injectable } from '@angular/core';
import { ThemeMode } from '../models/app.types';

export const THEME_STORAGE_KEY = 'ozon-app-web.theme';

@Injectable()
export class AppThemeService {
    themeMode: ThemeMode = 'light';

    get isDarkTheme(): boolean {
        return this.themeMode === 'dark';
    }

    get currentThemeLabel(): string {
        return this.themeMode === 'dark' ? 'Scuro' : 'Chiaro';
    }

    initialize(): void {
        const theme = this.readThemeFromQuery() || this.readThemeFromStorage() ||
            (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        this.setTheme(theme as ThemeMode, false);
    }

    setTheme(theme: ThemeMode, persist: boolean): void {
        this.themeMode = theme;
        if (typeof document !== 'undefined') {
            const root = document.documentElement;
            root.setAttribute('data-theme', theme);
            root.setAttribute('data-bs-theme', theme);
            root.style.colorScheme = theme;
        }
        if (persist && typeof window !== 'undefined') {
            window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        }
    }

    onThemeSwitchChanged(isDark: boolean): void {
        this.setTheme(isDark ? 'dark' : 'light', true);
    }

    private readThemeFromQuery(): ThemeMode | null {
        if (typeof window === 'undefined') return null;
        return this.normalizeTheme(new URLSearchParams(window.location.search).get('theme'));
    }

    private readThemeFromStorage(): ThemeMode | null {
        if (typeof window === 'undefined') return null;
        return this.normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
    }

    private normalizeTheme(v: unknown): ThemeMode | null {
        const n = String(v ?? '').trim().toLowerCase();
        return (n === 'light' || n === 'dark') ? n as ThemeMode : null;
    }
}
