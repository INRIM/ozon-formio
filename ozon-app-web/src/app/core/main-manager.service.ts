import { Injectable } from '@angular/core';
import { RuntimeConfigService } from './runtime-config.service';

export interface MainManagerReloadResult {
  reloaded: boolean;
  blocked: boolean;
  targetUrl: string;
}

@Injectable({ providedIn: 'root' })
export class MainManagerService {
  constructor(private readonly runtimeConfig: RuntimeConfigService) {}

  hardReloadToUrl(rawTarget: string): MainManagerReloadResult {
    const targetUrl = this.resolveTargetUrl(rawTarget);
    if (!targetUrl) {
      return { reloaded: false, blocked: false, targetUrl: '' };
    }
    if (this.isCrossOriginTargetBlocked(targetUrl)) {
      return { reloaded: false, blocked: true, targetUrl };
    }
    if (typeof window === 'undefined') {
      return { reloaded: false, blocked: false, targetUrl };
    }
    window.location.href = targetUrl;
    return { reloaded: true, blocked: false, targetUrl };
  }

  private resolveTargetUrl(rawTarget: string): string {
    const raw = String(rawTarget ?? '').trim();
    if (!raw) return '';
    const base = this.resolveSiteBaseUrl();
    try {
      return new URL(raw, base).toString();
    } catch {
      return '';
    }
  }

  private resolveSiteBaseUrl(): string {
    const config = this.runtimeConfig.getConfig();
    const configuredSiteUrl = this.normalizeAbsoluteHttpUrl(config.siteUrl);
    if (configuredSiteUrl) return configuredSiteUrl;
    if (typeof window !== 'undefined' && window.location.origin) {
      return `${window.location.origin.replace(/\/+$/, '')}/`;
    }
    return 'http://localhost/';
  }

  private isCrossOriginTargetBlocked(targetUrl: string): boolean {
    const targetOrigin = this.extractOrigin(targetUrl);
    if (!targetOrigin) return false;
    const allowed = this.resolveAllowedOrigins();
    if (!allowed.size) return false;
    return !allowed.has(targetOrigin);
  }

  private resolveAllowedOrigins(): Set<string> {
    const config = this.runtimeConfig.getConfig();
    const origins = new Set<string>();
    const addOrigin = (candidate: string): void => {
      const origin = this.extractOrigin(candidate);
      if (!origin) return;
      origins.add(origin);
    };

    config.allowedOrigins.forEach((entry) => addOrigin(entry));
    addOrigin(config.siteUrl);
    addOrigin(config.backendUrl);
    if (typeof window !== 'undefined') {
      addOrigin(window.location.origin);
    }
    return origins;
  }

  private normalizeAbsoluteHttpUrl(value: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      return parsed.toString().replace(/\/+$/, '') + '/';
    } catch {
      return '';
    }
  }

  private extractOrigin(value: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      return parsed.origin;
    } catch {
      return '';
    }
  }
}
