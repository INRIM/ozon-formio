import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { WebSocketActionsService } from './websocket-actions.service';
import { RuntimeConfigService } from './runtime-config.service';

describe('WebSocketActionsService', () => {
  let service: WebSocketActionsService;
  let runtimeConfig: RuntimeConfigService;
  let mockWebSocket: any;
  let originalWebSocket: any;

  beforeEach(() => {
    mockWebSocket = jasmine.createSpy('WebSocket').and.callFake(function (this: any, url: string) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.send = jasmine.createSpy('send');
      this.close = jasmine.createSpy('close');
      return this;
    });
    mockWebSocket.CONNECTING = 0;
    mockWebSocket.OPEN = 1;
    mockWebSocket.CLOSING = 2;
    mockWebSocket.CLOSED = 3;

    originalWebSocket = (window as any).WebSocket;
    (window as any).WebSocket = mockWebSocket;

    TestBed.configureTestingModule({
      providers: [RuntimeConfigService]
    });

    runtimeConfig = TestBed.inject(RuntimeConfigService);
    runtimeConfig.updateConfig({
      backendUrl: 'https://api.example.com',
      useProxy: false,
      appCode: 'test-app'
    });
    service = TestBed.inject(WebSocketActionsService);
  });

  afterEach(() => {
    (window as any).WebSocket = originalWebSocket;
    service.disconnect();
  });

  it('should resolve and build the correct websocket URL without a token (BE-3: auth via session cookie)', () => {
    service.connect();
    expect(mockWebSocket).toHaveBeenCalledWith('wss://api.example.com/ws/actions?app_code=test-app');
  });

  it('should transition connectionState to connected on open', fakeAsync(() => {
    let lastState: string | undefined;
    service.connectionState$.subscribe(state => lastState = state);

    service.connect();
    expect(lastState).toBe('connecting');

    const wsInstance = mockWebSocket.calls.mostRecent().returnValue;
    wsInstance.readyState = 1; // OPEN
    if (wsInstance.onopen) {
      wsInstance.onopen();
    }
    tick();
    expect(lastState).toBe('connected');
  }));

  it('should queue send messages when connection is not open and flush on open', fakeAsync(() => {
    service.send({
      request_id: 'req1',
      action: 'run',
      action_name: 'test',
      rec_name: 'rec1',
      data: {}
    });

    const wsInstance = mockWebSocket.calls.mostRecent().returnValue;
    expect(wsInstance.send).not.toHaveBeenCalled();

    wsInstance.readyState = 1; // OPEN
    if (wsInstance.onopen) {
      wsInstance.onopen();
    }
    tick();

    expect(wsInstance.send).toHaveBeenCalledWith(jasmine.stringContaining('req1'));
  }));

  it('should broadcast messages via messages$ subject', fakeAsync(() => {
    let received: any;
    service.messages$.subscribe(msg => received = msg);

    service.connect();
    const wsInstance = mockWebSocket.calls.mostRecent().returnValue;
    wsInstance.readyState = 1;
    if (wsInstance.onopen) {
      wsInstance.onopen();
    }

    const testPayload = {
      request_id: 'req1',
      type: 'action_status',
      status: 'completed',
      message: 'Success'
    };

    if (wsInstance.onmessage) {
      wsInstance.onmessage({ data: JSON.stringify(testPayload) });
    }
    tick();

    expect(received).toEqual(jasmine.objectContaining({
      request_id: 'req1',
      status: 'completed',
      message: 'Success'
    }));
  }));
});
