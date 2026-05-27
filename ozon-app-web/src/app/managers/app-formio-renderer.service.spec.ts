import { TestBed } from '@angular/core/testing';
import { AppFormioRendererService } from './app-formio-renderer.service';
import { OzonApiService } from '../core/ozon-api.service';

describe('AppFormioRendererService', () => {
  let service: AppFormioRendererService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppFormioRendererService,
        {
          provide: OzonApiService,
          useValue: jasmine.createSpyObj<OzonApiService>('OzonApiService', [
            'getRemoteSelect',
            'streamList'
          ])
        }
      ]
    });

    service = TestBed.inject(AppFormioRendererService);
  });

  it('should normalize readonly select components for viewer rendering', () => {
    const schema = {
      components: [
        {
          type: 'select',
          key: 'ruolo_sicurezza',
          input: true,
          properties: {
            readonly: 'y'
          }
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const select = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(select['disabled']).toBeTrue();
    expect(select['readOnly']).toBeTrue();
    expect(select['searchEnabled']).toBeFalse();
    expect(select['removeItemButton']).toBeFalse();
    expect(String(select['customClass'] ?? '')).toContain('ozon-select-readonly');
  });

  it('should tag outline buttons for css fallback', () => {
    const schema = {
      components: [
        {
          type: 'button',
          key: 'btn_import_ugov',
          theme: 'warning',
          customClass: 'btn-outline-primary mb-4 btn-sm'
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const button = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(String(button['customClass'] ?? '')).toContain('ozon-btn-custom-outline');
  });

  it('should coerce blank multiple fields to arrays using the Formio schema', () => {
    service.rawFormSchema = {
      components: [
        {
          type: 'select',
          key: 'delete_cascade',
          input: true,
          multiple: true
        }
      ]
    };

    expect(service.normalizeFormSubmissionData({
      rec_name: 'ACT-1',
      delete_cascade: ''
    })).toEqual(jasmine.objectContaining({
      rec_name: 'ACT-1',
      delete_cascade: []
    }));

    expect(service.normalizeFormSubmissionData({
      rec_name: 'ACT-1',
      delete_cascade: '["action_a","action_b"]'
    })).toEqual(jasmine.objectContaining({
      rec_name: 'ACT-1',
      delete_cascade: ['action_a', 'action_b']
    }));
  });
});
