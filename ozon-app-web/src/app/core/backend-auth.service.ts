import { Injectable } from '@angular/core';
import { RuntimeConfigService } from './runtime-config.service';
import { OzonApiService } from './ozon-api.service';

export interface BackendAuthResult {
  authenticated: boolean;
  loginRequired: boolean;
  redirectUrl: string;
  remoteUser: string;
  refreshed: boolean;
}

@Injectable({ providedIn: 'root' })
export class BackendAuthService {
  private inflightSync: Promise<BackendAuthResult> | null = null;
  private authenticated = false;
  private loginRequired = false;
  private remoteUser = '';
  private lastSessionPayload: unknown = null;

  constructor(
    private readonly api: OzonApiService,
    private readonly runtimeConfig: RuntimeConfigService
  ) {}

  isEnabled(): boolean {
    return this.runtimeConfig.getConfig().authMode === 'keycloak';
  }

  async bootstrap(): Promise<BackendAuthResult> {
    if (!this.isEnabled()) {
      return this.buildResult();
    }
    if (this.inflightSync) {
      return this.inflightSync;
    }
    this.inflightSync = this.syncSession()
      .finally(() => {
        this.inflightSync = null;
      });
    return this.inflightSync;
  }

  async refresh(): Promise<BackendAuthResult> {
    if (!this.isEnabled()) {
      return this.buildResult();
    }
    return this.syncSession();
  }

  logout(): BackendAuthResult {
    this.clearToken();
    this.authenticated = false;
    this.loginRequired = false;
    this.remoteUser = '';
    this.lastSessionPayload = null;
    return this.buildResult(false, this.getLogoutUrl());
  }

  consumeSessionPayload(): unknown {
    const payload = this.lastSessionPayload;
    this.lastSessionPayload = null;
    return payload;
  }

  getLoginUrl(): string {
    return this.api.resolveApiUrl(this.runtimeConfig.getConfig().authLoginPath);
  }

  getLogoutUrl(): string {
    return this.api.resolveApiUrl(this.runtimeConfig.getConfig().authLogoutPath);
  }

  private async syncSession(): Promise<BackendAuthResult> {
    try {
      const payload = await this.api.getSession();
      const session = this.unwrapPayload(payload);
      this.lastSessionPayload = payload;
      const token = this.readFirstString(session?.['token']);
      this.runtimeConfig.updateConfig({ baseToken: token });
      this.authenticated = true;
      this.loginRequired = false;
      this.remoteUser = this.resolveRemoteUser(session);
      return this.buildResult(true);
    } catch (error) {
      const status = Number((error as { status?: number })?.status ?? 0);
      if (status === 401 || status === 403) {
        this.clearToken();
        this.authenticated = false;
        this.loginRequired = true;
        this.remoteUser = '';
        this.lastSessionPayload = null;
        return this.buildResult(false, this.getLoginUrl());
      }
      throw error;
    }
  }

  private buildResult(refreshed = false, redirectUrl = ''): BackendAuthResult {
    return {
      authenticated: this.authenticated,
      loginRequired: this.loginRequired,
      redirectUrl,
      remoteUser: this.remoteUser,
      refreshed
    };
  }

  private clearToken(): void {
    this.runtimeConfig.updateConfig({ baseToken: '' });
  }

  private unwrapPayload(payload: unknown): Record<string, unknown> | null {
    let current = payload;
    const visited = new Set<unknown>();
    while (this.isRecord(current) && !visited.has(current)) {
      visited.add(current);
      const next = this.findNestedPayload(current);
      if (!next) {
        return current;
      }
      current = next;
    }
    return this.isRecord(current) ? current : null;
  }

  private findNestedPayload(record: Record<string, unknown>): Record<string, unknown> | null {
    const wrappers = ['content', 'data', 'payload', 'result', 'response', 'session'];
    for (const key of wrappers) {
      const candidate = record[key];
      if (this.isRecord(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private resolveRemoteUser(session: Record<string, unknown> | null): string {
    const user = this.isRecord(session?.['user']) ? session['user'] : {};
    return this.readFirstString(
      session?.['uid'],
      session?.['username'],
      session?.['user_name'],
      user['uid'],
      user['username'],
      user['email']
    );
  }

  private readFirstString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized) return normalized;
      }
    }
    return '';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}
