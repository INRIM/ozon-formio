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
            'streamList',
            'resolveApiUrl'
          ])
        }
      ]
    });

    service = TestBed.inject(AppFormioRendererService);
    const api = TestBed.inject(OzonApiService) as jasmine.SpyObj<OzonApiService>;
    api.resolveApiUrl.and.callFake((path: string) => `/api${path}`);
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

  it('should tag only native submit-key buttons for viewer hiding', () => {
    const schema = {
      components: [
        {
          type: 'button',
          key: 'submit',
          action: 'submit',
          label: 'Submit'
        },
        {
          type: 'button',
          key: 'esegui',
          label: 'esegui',
          properties: {
            btn_action_type: 'post',
            url_action: '/action/delete_record'
          }
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const components = prepared['components'] as Array<Record<string, unknown>>;

    expect(String(components[0]['customClass'] ?? '')).toContain('ozon-native-submit');
    expect(String(components[1]['customClass'] ?? '')).not.toContain('ozon-native-submit');
  });

  it('should convert configured non-submit buttons to inline action events', () => {
    const schema = {
      components: [
        {
          type: 'button',
          key: 'esegui',
          label: 'esegui',
          properties: {
            btn_action_type: 'post',
            url_action: 'url_action'
          }
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const button = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(button['action']).toBe('event');
    expect(button['event']).toBe('ozonInlineAction');
    expect(String(button['customClass'] ?? '')).toContain('ozon-inline-action');
  });

  it('should rewrite form placeholders only for rendered content components', () => {
    const schema = {
      components: [
        {
          type: 'content',
          key: 'preview',
          html: '<p>{{ form.data_value.title }}</p>',
          input: false
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const content = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(content['type']).toBe('content');
    expect(content['html']).toBe('<p>{{ data.data_value.title }}</p>');
  });

  it('should convert active editor content components to wysiwyg textareas without html rendering', () => {
    const schema = {
      components: [
        {
          type: 'content',
          key: 'editor',
          html: '<p>{{ form.data_value.title }}</p>',
          input: false,
          properties: {
            editor: 'active'
          }
        }
      ]
    };

    const submission: Record<string, unknown> = {};
    const prepared = service.prepareSchemaForRender(schema, submission);
    const editor = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(editor['type']).toBe('textarea');
    expect(editor['input']).toBeTrue();
    expect(editor['editor']).toBe('quill');
    expect(editor['wysiwyg']).toBeTrue();
    expect(editor['inputFormat']).toBe('html');
    expect(editor['html']).toBeUndefined();
    expect(editor['defaultValue']).toBe('<p>{{ form.data_value.title }}</p>');
    expect(submission['editor']).toBe('<p>{{ form.data_value.title }}</p>');
  });

  it('should not overwrite an existing active editor submission value with schema html', () => {
    const schema = {
      components: [
        {
          type: 'content',
          key: 'editor',
          html: '<p>Schema html</p>',
          input: false,
          properties: {
            editor: 'active'
          }
        }
      ]
    };
    const submission: Record<string, unknown> = { editor: '<p>Saved html</p>' };

    service.prepareSchemaForRender(schema, submission);

    expect(submission['editor']).toBe('<p>Saved html</p>');
  });

  it('should activate the runtime JSON editor for textareas with jeditor property', () => {
    const schema = {
      components: [
        {
          type: 'textarea',
          key: 'rules',
          label: 'Rules',
          input: true,
          tableView: true,
          properties: {
            jeditor: 'y'
          }
        },
        {
          type: 'textarea',
          key: 'notes',
          label: 'Notes',
          input: true
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, { rules: '{"enabled":true}' });
    const components = prepared['components'] as Array<Record<string, unknown>>;

    expect(components[0]['type']).toBe('ozonjsoneditor');
    expect(components[0]['input']).toBeTrue();
    expect(components[0]['tableView']).toBeFalse();
    expect(String(components[0]['customClass'])).toContain('ozon-formio-json-editor-field');
    expect(components[1]['type']).toBe('textarea');
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

  it('should normalize backend file payloads for Formio file components', () => {
    service.rawFormSchema = {
      components: [
        {
          type: 'file',
          key: 'file',
          input: true
        }
      ]
    };

    const normalized = service.normalizeFormSubmissionData({
      rec_name: 'REQ-1',
      file: [
        {
          filename: 'offerta.pdf',
          content_type: 'application/pdf',
          file_path: 'test_request/test_request.b68',
          url: '/test_request/test_request.b68/offerta.pdf',
          key: 'test_request.b68',
          base64: 'JVBERi0xLjc='
        }
      ]
    });

    expect(normalized['file']).toEqual([
      jasmine.objectContaining({
        filename: 'offerta.pdf',
        content_type: 'application/pdf',
        name: 'offerta.pdf',
        originalName: 'offerta.pdf',
        type: 'application/pdf',
        storage: 'base64',
        size: 8,
        url: 'data:application/pdf;base64,JVBERi0xLjc='
      })
    ]);
  });

  it('should normalize backend-managed file urls without requiring Formio storage', () => {
    service.rawFormSchema = {
      components: [
        {
          type: 'file',
          key: 'file',
          input: true
        }
      ]
    };

    const normalized = service.normalizeFormSubmissionData({
      file: [
        {
          filename: 'Inrim-QuiIAM-OFFERTA v4.pdf',
          content_type: 'application/pdf',
          url: '/test_request/test_request.b68/Inrim-QuiIAM-OFFERTA v4.pdf',
          key: 'test_request.b68'
        }
      ]
    });

    expect(normalized['file']).toEqual([
      jasmine.objectContaining({
        filename: 'Inrim-QuiIAM-OFFERTA v4.pdf',
        name: 'Inrim-QuiIAM-OFFERTA v4.pdf',
        originalName: 'Inrim-QuiIAM-OFFERTA v4.pdf',
        type: 'application/pdf',
        url: '/api/client/attachment/test_request/test_request.b68/Inrim-QuiIAM-OFFERTA%20v4.pdf'
      })
    ]);
  });

  it('should keep the form loader active until Formio ready when there are no async selects', async () => {
    service.formSchema = {
      components: [
        {
          type: 'textfield',
          key: 'title',
          input: true
        }
      ]
    };

    service.beginFormViewerLoad();
    service.scheduleRemoteSelectHydrationAfterRender({ title: 'A' });

    expect(service.formViewerLoading).toBeTrue();
    expect(service.formDataReady).toBeFalse();

    await service.onFormViewerReady();

    expect(service.formViewerLoading).toBeFalse();
    expect(service.formDataReady).toBeTrue();
  });

  it('retypes the legacy embeddable data-table stub (type "table" + properties.action_url) to ozon_data_table, so it does not collide with Form.io\'s native table layout component', () => {
    const schema = {
      components: [
        {
          type: 'table',
          key: 'ozonDataTable',
          input: false,
          properties: {
            action_url: '/action/list_group_members',
            model: 'res.partner',
            list_metadata_show: 'name,codicefiscale,'
          }
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const table = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(table['type']).toBe('ozon_data_table');
    expect(String(table['customClass'] ?? '')).toContain('ozon-form-data-table');
  });

  it('leaves Form.io\'s native table layout component untouched when it has no action_url property', () => {
    const schema = {
      components: [
        {
          type: 'table',
          key: 'layoutTable',
          numRows: 2,
          numCols: 2,
          rows: []
        }
      ]
    };

    const prepared = service.prepareSchemaForRender(schema, null);
    const table = (prepared['components'] as Array<Record<string, unknown>>)[0];

    expect(table['type']).toBe('table');
    expect(String(table['customClass'] ?? '')).toContain('ozon-form-table');
    expect(String(table['customClass'] ?? '')).not.toContain('ozon-form-data-table');
  });
});
