import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecordTransferToolsComponent } from './record-transfer-tools.component';
import { OzonApiService } from '../core/ozon-api.service';

describe('RecordTransferToolsComponent', () => {
  let fixture: ComponentFixture<RecordTransferToolsComponent>;
  let component: RecordTransferToolsComponent;
  let apiMock: jasmine.SpyObj<OzonApiService>;

  beforeEach(async () => {
    apiMock = jasmine.createSpyObj<OzonApiService>('OzonApiService', [
      'getAction',
      'getRecordSchema',
      'getSchemaModel',
      'updateRecord',
      'streamList',
      'deleteAction'
    ]);
    apiMock.getAction.and.resolveTo({ data: [] });
    apiMock.getRecordSchema.and.resolveTo({ components: [] });
    apiMock.getSchemaModel.and.resolveTo({ properties: {} });
    apiMock.updateRecord.and.resolveTo({ content: { data: { rec_name: 'row-1' } } });
    apiMock.streamList.and.resolveTo({
      result: {
        count: 0,
        totalCount: 0,
        contentType: 'application/json',
        order: 'rec_name asc',
        skip: '0',
        limit: '1',
        columnsRaw: '',
        columns: null
      },
      payloadLabel: 'default',
      retries: 0
    });
    apiMock.deleteAction.and.resolveTo({ mode: 'action', data: { status: 'ok' } });

    await TestBed.configureTestingModule({
      imports: [RecordTransferToolsComponent],
      providers: [
        { provide: OzonApiService, useValue: apiMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RecordTransferToolsComponent);
    component = fixture.componentInstance;
  });

  it('should render filtered export actions when export config is available', () => {
    component.exportConfig = {
      visible: true,
      model: 'component.demo',
      searchModel: 'demo.model',
      parent: '',
      hideAll: true,
      xlsFilteredLabel: 'XLS',
      csvFilteredLabel: 'CSV',
      jsonFilteredLabel: 'JSON'
    };

    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Export');
    expect(text).toContain('XLS');
    expect(text).toContain('CSV');
    expect(text).toContain('JSON');
    expect(text).not.toContain('XLS Tutti');
  });

  it('should open the import panel when import is enabled', () => {
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };

    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button');
    button.click();
    fixture.detectChanges();

    expect(component.importPanelOpen).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Template xlsx');
  });

  it('should export filtered rows through the current action endpoint', async () => {
    apiMock.getAction.and.resolveTo({
      data: [{ rec_name: 'row-1', title: 'Demo' }]
    });
    component.exportConfig = {
      visible: true,
      model: 'component.demo',
      searchModel: 'demo.model',
      parent: '',
      hideAll: true,
      xlsFilteredLabel: 'XLS',
      csvFilteredLabel: 'CSV',
      jsonFilteredLabel: 'JSON'
    };
    component.searchContext = {
      searchModel: 'demo.model',
      dataModel: 'component.demo',
      actionName: 'list_component_demo',
      baseQuery: {},
      currentQuery: { active: true },
      order: 'rec_name asc',
      totalCount: 1,
      fastSearchActive: false,
      fastSearchFormModel: '',
      fastSearchDataModel: '',
      fastSearchQueryFields: [],
      fastSearchFormData: {}
    };
    spyOn<any>(component, 'saveGeneratedFile');

    await component.exportFiltered('json');

    expect(apiMock.getAction).toHaveBeenCalledWith('list_component_demo', jasmine.objectContaining({
      query: { active: true },
      order: 'rec_name asc',
      skip: 0,
      limit: 1
    }));
    expect((component as any).saveGeneratedFile).toHaveBeenCalled();
  });

  it('should import preview rows via record upsert', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true },
        { type: 'number', key: 'qty', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'qty'];
    component.previewRows = [{ rec_name: 'row-1', qty: '4' }];

    await component.submitImport();

    expect(apiMock.updateRecord).toHaveBeenCalledWith(
      'demo.model',
      'row-1',
      jasmine.objectContaining({
        rec_name: 'row-1',
        qty: 4,
        data_value: jasmine.objectContaining({
          rec_name: 'row-1',
          qty: 4
        })
      })
    );
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should coerce empty strings for backend-only array and boolean fields', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    apiMock.getSchemaModel.and.resolveTo({
      fields: ['rec_name', 'tags', 'authenticate'],
      schema: {
        properties: {
          rec_name: { type: 'string' },
          tags: {
            anyOf: [
              { type: 'null' },
              { type: 'array', items: { type: 'string' } }
            ]
          },
          authenticate: {
            anyOf: [
              { type: 'null' },
              { type: 'boolean' }
            ]
          }
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'tags', 'authenticate'];
    component.previewRows = [{ rec_name: 'row-1', tags: '', authenticate: '' }];

    await component.submitImport();

    expect(apiMock.updateRecord).toHaveBeenCalledWith(
      'demo.model',
      'row-1',
      jasmine.objectContaining({
        rec_name: 'row-1',
        tags: [],
        authenticate: false,
        data_value: jasmine.objectContaining({
          rec_name: 'row-1',
          tags: [],
          authenticate: false
        })
      })
    );
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should infer array and boolean fields from existing rows when schema_model is unavailable', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true },
        { type: 'textfield', key: 'tags', input: true },
        { type: 'textfield', key: 'authenticate', input: true }
      ]
    });
    apiMock.getSchemaModel.and.rejectWith(new Error('404'));
    apiMock.streamList.and.callFake(async (_model, _payload, onItem: (item: unknown) => void) => {
      onItem({ rec_name: 'existing-row', tags: ['base'], authenticate: true });
      return {
        result: {
          count: 1,
          totalCount: 1,
          contentType: 'application/json',
          order: 'rec_name asc',
          skip: '0',
          limit: '20',
          columnsRaw: '',
          columns: null
        },
        payloadLabel: 'default',
        retries: 0
      };
    });
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };
    component.searchContext = {
      searchModel: 'component',
      dataModel: 'component',
      actionName: '',
      baseQuery: {},
      currentQuery: {},
      order: 'rec_name asc',
      totalCount: 1,
      fastSearchActive: false,
      fastSearchFormModel: '',
      fastSearchDataModel: '',
      fastSearchQueryFields: [],
      fastSearchFormData: {}
    };
    component.previewColumns = ['rec_name', 'tags', 'authenticate'];
    component.previewRows = [{ rec_name: 'row-1', tags: '', authenticate: '' }];

    await component.submitImport();

    expect(apiMock.updateRecord).toHaveBeenCalledWith(
      'component',
      'row-1',
      jasmine.objectContaining({
        rec_name: 'row-1',
        tags: [],
        authenticate: false
      })
    );
    expect(component.panelMessage).toContain('Import completato: 1');
  });
});
