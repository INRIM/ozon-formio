import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { RuntimeConfigService } from './runtime-config.service';

export interface WebSocketActionPayload {
  request_id: string;
  action: string;
  action_name: string;
  rec_name: string;
  data: Record<string, unknown>;
}

export interface WebSocketActionResponse {
  request_id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message: string;
  data?: {
    next_action_url?: string;
    result?: unknown;
  };
}

@Injectable({ providedIn: 'root' })
export class WebSocketActionsService implements OnDestroy {
  private ws: WebSocket | null = null;
  private readonly messagesSubject = new Subject<WebSocketActionResponse>();
  readonly messages$: Observable<WebSocketActionResponse> = this.messagesSubject.asObservable();

  private readonly connectionStateSubject = new BehaviorSubject<'disconnected' | 'connecting' | 'connected'>('disconnected');
  readonly connectionState$ = this.connectionStateSubject.asObservable();

  private reconnectTimeoutId: any = null;
  private intentionallyClosed = false;
  private pendingQueue: string[] = [];

  constructor(private readonly runtimeConfig: RuntimeConfigService) {}

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionallyClosed = false;
    this.connectionStateSubject.next('connecting');

    const url = this.buildWebSocketUrl();
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connectionStateSubject.next('connected');
        this.flushQueue();
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as WebSocketActionResponse;
          if (payload && payload.request_id) {
            this.messagesSubject.next(payload);
          }
        } catch (e) {
          console.error('[WS] Failed to parse message', e);
        }
      };

      this.ws.onclose = () => {
        this.connectionStateSubject.next('disconnected');
        this.ws = null;
        if (!this.intentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WS] error', err);
        // Let onclose handle reconnect
      };
    } catch (err) {
      console.error('[WS] Failed to create WebSocket', err);
      this.connectionStateSubject.next('disconnected');
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionStateSubject.next('disconnected');
  }

  send(payload: WebSocketActionPayload): void {
    this.connect();
    const msg = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pendingQueue.push(msg);
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.pendingQueue.length > 0) {
      const msg = this.pendingQueue.shift();
      if (msg) {
        this.ws.send(msg);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeoutId) {
      return;
    }
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connect();
    }, 5000);
  }

  private buildWebSocketUrl(): string {
    const cfg = this.runtimeConfig.getConfig();
    const useProxy = cfg.useProxy;
    const backendUrl = cfg.backendUrl || '';
    const token = cfg.baseToken?.trim() || '';
    const appCode = cfg.appCode?.trim() || '';

    let base = '';
    if (useProxy) {
      const loc = typeof window !== 'undefined' ? window.location : null;
      if (loc) {
        const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        base = `${protocol}//${loc.host}/api`;
      } else {
        base = 'ws://localhost:4200/api';
      }
    } else {
      base = backendUrl.replace(/^http/i, 'ws').replace(/\/+$/, '');
    }

    let url = `${base}/ws/actions`;
    const params = new URLSearchParams();
    if (token) {
      params.set('token', token);
    }
    if (appCode) {
      params.set('app_code', appCode);
    }
    const queryStr = params.toString();
    if (queryStr) {
      url += `?${queryStr}`;
    }
    return url;
  }
}
