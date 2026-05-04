import { TestBed } from '@angular/core/testing';
import { OzonApiService } from './ozon-api.service';
import { RuntimeConfigService } from './runtime-config.service';

describe('OzonApiService', () => {
  let service: OzonApiService;
  let runtimeConfig: RuntimeConfigService;
  let fakeClockInstalled = false;

  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        RuntimeConfigService,
        OzonApiService
      ]
    });

    runtimeConfig = TestBed.inject(RuntimeConfigService);
    runtimeConfig.updateConfig({
      backendUrl: 'http://localhost:7999',
      useProxy: true,
      sessionCacheTtlMs: 30000
    });
    service = TestBed.inject(OzonApiService);
  });

  afterEach(() => {
    if (fakeClockInstalled) {
      jasmine.clock().uninstall();
      fakeClockInstalled = false;
    }
    window.localStorage.clear();
  });

  it('should reuse get_session payload within the configured ttl', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ uid: 'alice' }));

    const first = await service.getSession();
    const second = await service.getSession();

    expect(first).toEqual({ uid: 'alice' });
    expect(second).toEqual({ uid: 'alice' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/api/get_session');
  });

  it('should refetch get_session when the ttl expires', async () => {
    jasmine.clock().install();
    fakeClockInstalled = true;
    jasmine.clock().mockDate(new Date('2026-05-03T09:00:00Z'));

    const fetchSpy = spyOn(globalThis, 'fetch').and.returnValues(
      Promise.resolve(jsonResponse({ uid: 'alice' })),
      Promise.resolve(jsonResponse({ uid: 'bob' }))
    );

    await service.getSession();
    jasmine.clock().tick(29999);
    await service.getSession();
    jasmine.clock().tick(2);
    const refreshed = await service.getSession();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(refreshed).toEqual({ uid: 'bob' });
  });

  it('should deduplicate concurrent get_session requests', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = spyOn(globalThis, 'fetch').and.returnValue(fetchPromise);

    const firstPromise = service.getSession();
    const secondPromise = service.getSession();
    resolveFetch(jsonResponse({ uid: 'alice' }));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(secondPromise).toBe(firstPromise);
    expect(first).toEqual({ uid: 'alice' });
    expect(second).toEqual({ uid: 'alice' });
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
