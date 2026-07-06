import { TestBed } from '@angular/core/testing';
import { OzonApiService } from '../core/ozon-api.service';
import { AppTableManagerService } from './app-table-manager.service';
import { AppFormioRendererService } from './app-formio-renderer.service';

describe('AppTableManagerService', () => {
  let service: AppTableManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppTableManagerService,
        AppFormioRendererService,
        {
          provide: OzonApiService,
          useValue: jasmine.createSpyObj<OzonApiService>('OzonApiService', [
            'getRemoteSelect'
          ])
        }
      ]
    });

    service = TestBed.inject(AppTableManagerService);
  });

  it('should convert active editor content components to wysiwyg textareas', async () => {
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
    const hydrated = await service.hydrateRemoteSelectSchema(schema, submission);
    const editor = (hydrated['components'] as Array<Record<string, unknown>>)[0];

    expect(editor['type']).toBe('textarea');
    expect(editor['input']).toBeTrue();
    expect(editor['editor']).toBe('quill');
    expect(editor['wysiwyg']).toBeTrue();
    expect(editor['inputFormat']).toBe('html');
    expect(editor['html']).toBeUndefined();
    expect(editor['defaultValue']).toBe('<p>{{ form.data_value.title }}</p>');
    expect(submission['editor']).toBe('<p>{{ form.data_value.title }}</p>');
  });

  it('should clear table render loader when rows have no renderable sample data', async () => {
    service.rawFormSchema = {
      components: [
        {
          type: 'textfield',
          key: 'title',
          input: true
        }
      ]
    };

    const rows = [{ __rec_name: 'REQ-1' }];
    const revision = service.prepareTableCellRenderers(rows);

    expect(service.tableRenderLoading).toBeTrue();

    await service.warmTableCellRenderers(rows, revision);

    expect(service.tableRenderLoading).toBeFalse();
  });

  it('should select a row before opening it from desktop row click', async () => {
    const row = { __rowid: 1, __rec_name: 'REC-1' };
    const rebuildMenus = jasmine.createSpy('rebuildMenus');
    const openRecord = jasmine.createSpy('openRecord').and.resolveTo();

    await service.onTableRowOpen(row, new MouseEvent('click'), rebuildMenus, openRecord);

    expect(service.selectedRecordName).toBe('REC-1');
    expect(service.selectedRows).toEqual([row]);
    expect(rebuildMenus).toHaveBeenCalled();
    expect(openRecord).toHaveBeenCalled();
  });
});
