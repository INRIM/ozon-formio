import { TestBed } from '@angular/core/testing';
import { Formio } from '@formio/js';
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

  it('should post export data requests to the backend api with parent context', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ content: { data: [{ rec_name: 'r1' }] } }));

    const response = await service.getExportData('demo.model', { query: { owner_uid: 'alice' } }, 'parent-1');

    expect(response).toEqual({ content: { data: [{ rec_name: 'r1' }] } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/api/export_data/demo.model?parent=parent-1');
    expect(JSON.parse((fetchSpy.calls.mostRecent().args[1] as RequestInit).body as string)).toEqual({
      query: { owner_uid: 'alice' }
    });
  });

  it('should build resource data requests for template generation from session domain', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ content: { data: [] } }));

    await service.getResourceData('demo.model', {
      fields: ['rec_name', 'owner_uid'],
      domainFromSession: true
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/api/resource/data/demo.model?fields=rec_name%2Cowner_uid&domain_from_session=true');
  });

  it('should post import payloads to the backend api', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ status: 'done', ok: 1 }));

    const response = await service.importData('demo.model', {
      fields: [{ name: 'rec_name' }],
      data: [{ rec_name: 'row-1' }],
      delete_before: true
    });

    expect(response).toEqual({ status: 'done', ok: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.calls.mostRecent().args[0]).toBe('/api/import/demo.model');
  });

  it('should rewrite builder resource requests with an object payload and clear stale body strings', () => {
    const args: any = {
      url: 'http://localhost/form?type=resource&skip=0&limit=1000000',
      opts: {
        body: '"stale"'
      }
    };

    (service as any).rewriteFormioBuilderResourceUrl(args);

    expect(args.method).toBe('POST');
    expect(args.url).toContain('/api/list/component');
    expect(args.data).toEqual({
      order: '',
      skip: 0,
      limit: 1000000,
      query: { type: 'resource' }
    });
    expect(args.opts.body).toBeUndefined();
  });

  it('should normalize remote select payload strings before forwarding Formio requests', () => {
    (service as any).registerRemoteSelectPayload(
      'req-1',
      '{"order":"","skip":0,"limit":1000000,"query":{"type":"resource"}}',
      { 'X-Test': '1' }
    );
    const args: any = {
      url: 'http://localhost/__ozon_remote__/list/component?__ozon_id=req-1',
      opts: {
        body: '"legacy-stringified-body"'
      },
      headers: {}
    };

    (service as any).attachTokenToFormioRequest(args);

    expect(args.method).toBe('POST');
    expect(args.url).toContain('/api/list/component');
    expect(args.data).toEqual({
      order: '',
      skip: 0,
      limit: 1000000,
      query: { type: 'resource' }
    });
    expect(args.opts.body).toBeUndefined();
    expect(args.opts.headers['X-Test']).toBe('1');
  });

  it('should avoid double-stringifying raw json request bodies', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ ok: true }));

    await (service as any).fetchJson('/demo', {
      method: 'POST',
      body: '{"order":"","skip":0,"limit":1000000,"query":{"type":"resource"}}'
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.calls.mostRecent().args[1] as RequestInit).body).toBe('{"order":"","skip":0,"limit":1000000,"query":{"type":"resource"}}');
  });

  it('should send an object body when Formio rewrites builder resource requests', async () => {
    const fetchSpy = spyOn(Formio as any, 'fetch').and.resolveTo(jsonResponse({
      content: {
        data: [{
          _id: '665f0f51f2d5000011223344',
          rec_name: 'resource.form.1',
          label: 'Resource Form 1',
          schema: {
            components: [{ type: 'textfield', key: 'name', label: 'Name' }]
          }
        }]
      }
    }));

    const response = await (Formio as any).makeStaticRequest('http://localhost/form?type=resource&skip=0&limit=1000000', 'GET', null, {});

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.calls.mostRecent().args[0])).toContain('/api/list/component');
    expect(JSON.parse((fetchSpy.calls.mostRecent().args[1] as RequestInit).body as string)).toEqual({
      order: '',
      skip: 0,
      limit: 1000000,
      query: { type: 'resource' }
    });
    expect(response).toEqual([{
      rec_name: 'resource.form.1',
      label: 'Resource Form 1',
      id: 'resource.form.1',
      _id: 'resource.form.1',
      name: 'resource.form.1',
      title: 'Resource Form 1',
      schema: {
        components: [{ type: 'textfield', key: 'name', label: 'Name' }]
      },
      components: [{ type: 'textfield', key: 'name', label: 'Name' }]
    }]);
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
