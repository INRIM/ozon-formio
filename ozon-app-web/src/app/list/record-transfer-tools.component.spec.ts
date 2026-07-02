import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecordTransferToolsComponent } from './record-transfer-tools.component';
import { OzonApiService } from '../core/ozon-api.service';

describe('RecordTransferToolsComponent', () => {
  let fixture: ComponentFixture<RecordTransferToolsComponent>;
  let component: RecordTransferToolsComponent;
  let apiMock: jasmine.SpyObj<OzonApiService>;

  const realComponentImportRow = () => ({
    _id: '686e0695b84b76cd83a811fb',
    app_code: [],
    parent: '',
    process_id: '',
    process_task_id: '',
    type: 'resource',
    default: false,
    active: true,
    childs: [],
    rec_name: 'classificazione_persona',
    title: 'Classificazione Persona',
    data_model: '',
    path: '',
    parent_name: '',
    components: "[{'label':'Columns','columns':[{'components':[{'label':'Attivo','customClass':'pl-3','tableView':False,'defaultValue':False,'validateWhenHidden':False,'key':'active','type':'checkbox','input':True}],'width':3,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':3}],'key':'columns','type':'columns','input':False,'tableView':False},{'type':'button','label':'Submit','key':'submit','disableOnInvalid':True,'input':True,'tableView':False}]",
    links: {},
    no_cancel: 0,
    display: 'form',
    action: '',
    tags: [],
    settings: {},
    properties: {
      rheader: '1',
      rfooter: '1',
      send_mail_create: '0',
      send_mail_update: '0',
      form_disabled: '0',
      no_submit: '0',
      sort: 'list_order:asc',
      queryformeditable: '{}'
    },
    handle_global_change: 0,
    process_tenant: '',
    make_virtual_model: false,
    projectId: 'persona, 1.3.0',
    owner_uid: 'admin',
    status: 'ok',
    message: '',
    tz: 'Europe/Rome',
    data_value: { ignored: true }
  });

  beforeEach(async () => {
    apiMock = jasmine.createSpyObj<OzonApiService>('OzonApiService', [
      'getAction',
      'getRecordSchema',
      'importData',
      'importClean',
      'updateRecord',
      'streamList',
      'deleteAction',
      'filterFastSearch'
    ]);
    apiMock.filterFastSearch.and.resolveTo({ count: 0, totalCount: 0, contentType: 'application/json', data: [] } as any);
    apiMock.getAction.and.resolveTo({ data: [] });
    apiMock.getRecordSchema.and.resolveTo({ components: [] });
    apiMock.importData.and.resolveTo({ status: 'ok', rec_name: 'row-1' });
    apiMock.importClean.and.resolveTo({ status: 'ok', model: 'demo.model' });
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

  it('should export filtered rows through the fast search endpoint if fast search is active', async () => {
    apiMock.filterFastSearch.and.callFake(async (actionName: string, payload: any, onItem: (item: unknown) => void) => {
      onItem({ rec_name: 'fs-row-1', title: 'FS Demo' });
      return { count: 1, totalCount: 1, contentType: 'application/json', data: [] } as any;
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
      currentQuery: {},
      order: 'rec_name asc',
      totalCount: 1,
      fastSearchActive: true,
      fastSearchFormModel: 'fs-form',
      fastSearchDataModel: 'demo.model',
      fastSearchQueryFields: [{ name: 'name', value: 'foo' }],
      fastSearchFormData: { name: 'foo' }
    };
    spyOn<any>(component, 'saveGeneratedFile');

    await component.exportFiltered('json');

    expect(apiMock.filterFastSearch).toHaveBeenCalledWith('list_component_demo', jasmine.objectContaining({
      query_fields: [{ name: 'name', value: 'foo' }],
      order: 'rec_name asc',
      skip: 0,
      limit: 1
    }), jasmine.any(Function));
    expect((component as any).saveGeneratedFile).toHaveBeenCalled();
  });

  it('should import preview rows through the import endpoint', async () => {
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

    expect(apiMock.importData).toHaveBeenCalledWith(
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-1',
        qty: 4
      })
    );
    expect(apiMock.importClean).not.toHaveBeenCalled();
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should emit global import lifecycle events even when a row import fails', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    apiMock.importData.and.rejectWith(new Error('Gateway Timeout'));
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name'];
    component.previewRows = [{ rec_name: 'row-1' }];
    const busyStates: boolean[] = [];
    let finishedCount = 0;
    component.importBusyChange.subscribe((value) => busyStates.push(value));
    component.importFinished.subscribe(() => { finishedCount += 1; });

    await component.submitImport();

    expect(busyStates).toEqual([true, false]);
    expect(finishedCount).toBe(1);
    expect(component.importResultLines).toEqual(['row-1: Gateway Timeout']);
  });

  it('should import rows sequentially and keep per-row status', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true },
        { type: 'number', key: 'qty', input: true }
      ]
    });
    apiMock.importData.and.returnValues(
      Promise.resolve({ status: 'ok', rec_name: 'row-1' }),
      Promise.resolve({ status: 'error', message: 'Record:row-2, msg: errore backend' })
    );
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.deleteBefore = true;
    component.previewColumns = ['rec_name', 'qty'];
    component.previewRows = [
      { __sourceRow: 2, rec_name: 'row-1', qty: '4' },
      { __sourceRow: 3, rec_name: 'row-2', qty: '5' }
    ];

    await component.submitImport();

    expect(apiMock.importClean).toHaveBeenCalledOnceWith('demo.model');
    expect(apiMock.importData.calls.count()).toBe(2);
    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-1',
        qty: 4
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-2',
        qty: 5
      })
    ]);
    expect(component.importRowStatuses).toEqual([
      jasmine.objectContaining({ rowReference: 'row-1', recName: 'row-1', ok: true }),
      jasmine.objectContaining({ rowReference: 'row-2', recName: 'row-2', ok: false, message: 'Record:row-2, msg: errore backend' })
    ]);
    expect(component.importResultLines).toContain('row-2: Record:row-2, msg: errore backend');
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should treat 200 import responses with fail=false or non-error payloads as success', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    let importCall = 0;
    apiMock.importData.and.callFake(async () => {
      importCall += 1;
      if (importCall === 1) throw new Error('Internal Server Error');
      if (importCall === 2) return { fail: false, ok: 0, rec_name: 'richiesta_persona' };
      if (importCall === 3) return { rec_name: 'persona' };
      return { content: { data: { rec_name: 'richiesta_persona_ext' } } };
    });
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name'];
    component.previewRows = [
      { __sourceRow: 2, rec_name: 'codice_fiscale' },
      { __sourceRow: 3, rec_name: 'richiesta_persona' },
      { __sourceRow: 4, rec_name: 'persona' },
      { __sourceRow: 5, rec_name: 'richiesta_persona_ext' }
    ];

    await component.submitImport();

    expect(component.importRowStatuses).toEqual([
      jasmine.objectContaining({ rowReference: 'codice_fiscale', recName: 'codice_fiscale', ok: false, message: 'Internal Server Error' }),
      jasmine.objectContaining({ rowReference: 'richiesta_persona', recName: 'richiesta_persona', ok: true }),
      jasmine.objectContaining({ rowReference: 'persona', recName: 'persona', ok: true }),
      jasmine.objectContaining({ rowReference: 'richiesta_persona_ext', recName: 'richiesta_persona_ext', ok: true })
    ]);
    expect(component.importResultLines).toEqual([
      'codice_fiscale: Internal Server Error'
    ]);
    expect(component.panelMessage).toContain('Import completato: 3');
  });

  it('should coerce multiple-select field empty string to array and json string to list', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'select', key: 'apps', input: true, multiple: true }
          ]
        },
        data: {
          rec_name: '',
          apps: ''
        }
      }
    });
    apiMock.importData.and.returnValues(
      Promise.resolve({ status: 'ok', rec_name: 'apps-empty' }),
      Promise.resolve({ status: 'ok', rec_name: 'apps-list' })
    );
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'apps'];
    component.previewRows = [
      { rec_name: 'apps-empty', apps: '' },
      { rec_name: 'apps-list', apps: '["persona","core"]' }
    ];

    await component.submitImport();

    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'apps-empty',
        apps: []
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'apps-list',
        apps: ['persona', 'core']
      })
    ]);
    expect(component.panelMessage).toContain('Import completato: 2');
  });

  it('should read Formio components from record content.data.components', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        data: {
          rec_name: '',
          apps: '',
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'select', key: 'apps', input: true, multiple: true }
          ]
        }
      }
    });
    apiMock.importData.and.returnValues(
      Promise.resolve({ status: 'ok', rec_name: 'apps-empty-formio' }),
      Promise.resolve({ status: 'ok', rec_name: 'apps-list-formio' })
    );
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'apps'];
    component.previewRows = [
      { rec_name: 'apps-empty-formio', apps: '' },
      { rec_name: 'apps-list-formio', apps: '["persona","core"]' }
    ];

    await component.submitImport();

    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'apps-empty-formio',
        apps: []
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'apps-list-formio',
        apps: ['persona', 'core']
      })
    ]);
    expect(component.panelMessage).toContain('Import completato: 2');
  });

  it('should pass unknown fields as raw strings when not defined in form schema', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'tags', 'authenticate'];
    component.previewRows = [{ rec_name: 'row-1', tags: '', authenticate: '' }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-1',
        tags: '',
        authenticate: ''
      })
    );
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should keep imported scalar values when Formio returns empty objects for single fields', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'select', key: 'user_function', input: true },
            { type: 'select', key: 'model', input: true },
            { type: 'select', key: 'menu_group', input: true },
            { type: 'select', key: 'next_action_name', input: true }
          ]
        }
      }
    });
    spyOn<any>(component, 'createFormInstanceForImport').and.resolveTo({
      form: {},
      container: document.createElement('div')
    });
    spyOn<any>(component, 'extractFormioSubmissionData').and.returnValue({
      rec_name: 'submit_action',
      user_function: {},
      model: {},
      menu_group: {},
      next_action_name: {}
    });
    spyOn<any>(component, 'destroyFormInstance').and.stub();
    component.importConfig = {
      visible: true,
      model: 'action',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'user_function', 'model', 'menu_group', 'next_action_name'];
    component.previewRows = [{
      rec_name: 'submit_action',
      user_function: '',
      model: 'resource',
      menu_group: 'Config',
      next_action_name: ''
    }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'action',
      jasmine.objectContaining({
        rec_name: 'submit_action',
        user_function: '',
        model: 'resource',
        menu_group: 'Config',
        next_action_name: ''
      })
    );
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should coerce legacy app_code arrays to strings when the Formio field is scalar', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'textfield', key: 'app_code', input: true }
          ]
        },
        data: {
          rec_name: '',
          app_code: ''
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'app_code'];
    component.previewRows = [
      { rec_name: 'row-empty', app_code: [] },
      { rec_name: 'row-single', app_code: ['nob-test'] }
    ];
    apiMock.importData.and.returnValues(
      Promise.resolve({ status: 'ok', rec_name: 'row-empty' }),
      Promise.resolve({ status: 'ok', rec_name: 'row-single' })
    );

    await component.submitImport();

    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-empty',
        app_code: ''
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-single',
        app_code: 'nob-test'
      })
    ]);
    expect(component.panelMessage).toContain('Import completato: 2');
  });

  it('should coerce stringified app_code arrays to strings when the empty record model defines string', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'textfield', key: 'app_code', input: true }
          ]
        },
        data: {
          rec_name: '',
          app_code: ''
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'app_code'];
    component.previewRows = [
      { rec_name: 'row-single-json', app_code: '["persona"]' },
      { rec_name: 'row-multi-python', app_code: "['persona','core']" }
    ];
    apiMock.importData.and.returnValues(
      Promise.resolve({ status: 'ok', rec_name: 'row-single-json' }),
      Promise.resolve({ status: 'ok', rec_name: 'row-multi-python' })
    );

    await component.submitImport();

    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'row-single-json',
        app_code: 'persona'
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'row-multi-python',
        app_code: 'persona,core'
      })
    ]);
    expect(component.panelMessage).toContain('Import completato: 2');
  });

  it('should coerce app_code arrays to strings when importing a real json file', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'textfield', key: 'app_code', input: true }
          ]
        },
        data: {
          rec_name: '',
          app_code: ''
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    const file = new File(
      [JSON.stringify([
        { rec_name: 'json-single', app_code: ['persona'] },
        { rec_name: 'json-multi', app_code: ['persona', 'core'] }
      ])],
      'menu_group.json',
      { type: 'application/json' }
    );

    await (component as any).loadPreview(file);
    await component.submitImport();

    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'json-single',
        app_code: 'persona'
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'json-multi',
        app_code: 'persona,core'
      })
    ]);
    expect(component.panelMessage).toContain('Import completato: 2');
  });

  it('should coerce app_code array literals to strings when importing a real spreadsheet file', async () => {
    const originalXlsx = window.XLSX;
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'textfield', key: 'app_code', input: true }
          ]
        },
        data: {
          rec_name: '',
          app_code: ''
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    window.XLSX = {
      read: () => ({
        SheetNames: ['Import Template'],
        Sheets: { 'Import Template': {} }
      }),
      write: () => new Uint8Array(),
      utils: {
        sheet_to_json: () => [
          { rec_name: 'xls-single', app_code: '["persona"]' },
          { rec_name: 'xls-multi', app_code: "['persona','core']" }
        ],
        json_to_sheet: () => ({}),
        aoa_to_sheet: () => ({}),
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: () => undefined
      }
    };

    try {
      const file = new File([new Uint8Array([1])], 'menu_group.xlsx');

      await (component as any).loadPreview(file);
      await component.submitImport();

      expect(apiMock.importData.calls.argsFor(0)).toEqual([
        'menu_group',
        jasmine.objectContaining({
          rec_name: 'xls-single',
          app_code: 'persona'
        })
      ]);
      expect(apiMock.importData.calls.argsFor(1)).toEqual([
        'menu_group',
        jasmine.objectContaining({
          rec_name: 'xls-multi',
          app_code: 'persona,core'
        })
      ]);
      expect(component.panelMessage).toContain('Import completato: 2');
    } finally {
      window.XLSX = originalXlsx;
    }
  });

  it('should keep empty multiple fields as empty arrays when the blank model returns empty strings', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true },
            { type: 'select', key: 'apps', input: true, multiple: true }
          ]
        },
        data: {
          rec_name: '',
          apps: ''
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'menu_group',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'apps'];
    component.previewRows = [
      { rec_name: 'apps-empty', apps: '' },
      { rec_name: 'apps-list', apps: '["persona","core"]' }
    ];
    apiMock.importData.and.returnValues(
      Promise.resolve({ status: 'ok', rec_name: 'apps-empty' }),
      Promise.resolve({ status: 'ok', rec_name: 'apps-list' })
    );

    await component.submitImport();

    expect(apiMock.importData.calls.argsFor(0)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'apps-empty',
        apps: []
      })
    ]);
    expect(apiMock.importData.calls.argsFor(1)).toEqual([
      'menu_group',
      jasmine.objectContaining({
        rec_name: 'apps-list',
        apps: ['persona', 'core']
      })
    ]);
    expect(component.panelMessage).toContain('Import completato: 2');
  });

  it('should parse components as json when importing spreadsheet rows', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'components'];
    component.previewRows = [{
      __sourceRow: 4,
      rec_name: 'row-1',
      components: "[{'type':'textfield','key':'name','label':'Nome','input':true}]"
    }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-1',
        components: [
          jasmine.objectContaining({
            type: 'textfield',
            key: 'name',
            label: 'Nome',
            input: true
          })
        ]
      })
    );
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should parse quoted spreadsheet components payloads as json', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'components'];
    component.previewRows = [{
      __sourceRow: 2,
      rec_name: 'row-quoted',
      components: '"[{""type"":""textfield"",""key"":""name"",""label"":""Nome"",""input"":true}]"'
    }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'demo.model',
      jasmine.objectContaining({
        components: [
          jasmine.objectContaining({
            type: 'textfield',
            key: 'name',
            label: 'Nome',
            input: true
          })
        ]
      })
    );
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should parse backslash escaped spreadsheet components payloads as json', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      content: {
        schema: {
          components: [
            { type: 'textfield', key: 'rec_name', input: true }
          ]
        },
        data: {
          rec_name: '',
          components: []
        }
      }
    });
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'components'];
    component.previewRows = [{
      __sourceRow: 2,
      rec_name: 'row-escaped',
      components: "[{\\'type\\':\\'textfield\\',\\'key\\':\\'name\\',\\'label\\':\\'Nome\\',\\'input\\':true}]"
    }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'component',
      jasmine.objectContaining({
        rec_name: 'row-escaped',
        components: [
          jasmine.objectContaining({
            type: 'textfield',
            key: 'name',
            label: 'Nome',
            input: true
          })
        ]
      })
    );
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should parse the real spreadsheet components payload as json', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };

    const realComponentsPayload = String.raw`[{'title':'CF','collapsible':False,'hideLabel':True,'key':'pnl_cf','logic':[{'name':'chk nuovo','trigger':{'type':'json','json':{'!=':[{'var':'form.stato'},'nuovo']}},'actions':[{'name':'hide','type':'property','property':{'label':'Hidden','value':'hidden','type':'boolean'},'state':True}]}],'type':'panel','label':'Panel','input':False,'tableView':False,'components':[{'label':'Columns','columns':[{'components':[],'width':4,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':4},{'components':[{'label':'Codice Fiscale','applyMaskOn':'change','tableView':True,'validate':{'required':True},'validateWhenHidden':False,'key':'codice_fiscale','type':'textfield','input':True}],'width':4,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':4},{'components':[],'size':'md','width':4,'currentWidth':4}],'key':'columns','type':'columns','input':False,'tableView':False}]},{'title':'Classificazione','customClass':'m-0 p-0','collapsible':False,'hideLabel':True,'key':'pnl_classificazione','logic':[{'name':'chk ins/agg','trigger':{'type':'json','json':{'!':[{'in':[{'var':'form.stato'},['inserimento','aggiornamento']]}]}},'actions':[{'name':'hide','type':'property','property':{'label':'Hidden','value':'hidden','type':'boolean'},'state':True}]}],'type':'panel','label':'Panel','input':False,'tableView':False,'components':[{'html':'<p style="text-align:center;">{% if form.stato == \'inserimento\' %}</p><h2 style="text-align:center;"><span class="text-big"><strong>Richiesta Inserimento Persona</strong></span></h2><figure class="table"><table><tbody><tr><td><strong>Codice Fiscale</strong></td><td>{{ form.data_value.codice_fiscale }}</td></tr></tbody></table></figure><p style="text-align:center;">{% endif %}</p><p style="text-align:center;">{% if form.stato == \'aggiornamento\' %}</p><h2 style="text-align:center;"><span class="text-big"><strong>Richiesta Aggiornamento Persona</strong></span></h2><h4 style="text-align:center;"><strong>{{ form.data_value.persona }}</strong></h4><figure class="table"><table><tbody><tr><td><strong>Codice Fiscale</strong></td><td>{{ form.data_value.codice_fiscale }}</td></tr><tr><td><strong>Classificazione</strong></td><td>{{ form.data_value.persona_classificazione }}</td></tr><tr><td><strong>Referente Interno</strong></td><td>{{ form.data_value.persona_referenteInterno }}</td></tr><tr><td><strong>Ente Azienda</strong></td><td>{{ form.data_value.persona_ente_azienda }}</td></tr></tbody></table></figure><p style="text-align:center;">{% endif %}</p>','label':'Editor','customClass':'w-75 mx-auto','refreshOnChange':False,'key':'editor','properties':{'eval_tmp':'yes'},'type':'content','input':False,'tableView':False},{'label':'Columns','columns':[{'components':[],'width':4,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':4},{'components':[{'label':'Classificazione','widget':'choicesjs','tableView':True,'dataSrc':'custom','data':{'resource':'classificazione_persona','custom':'classificazione_resource'},'idPath':'code','validate':{'required':True},'validateWhenHidden':False,'key':'classificazione','type':'select','input':True}],'width':4,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':4},{'components':[],'size':'md','width':4,'currentWidth':4}],'key':'columns1','type':'columns','input':False,'tableView':False}]},{'label':'Columns','columns':[{'components':[],'width':4,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':4},{'components':[{'label':'Avvia Verifica','showValidations':False,'theme':'warning','block':True,'customClass':'btn-outline-primary mb-2','tableView':False,'key':'aggiungi_doc_pagamento','properties':{'btn_action_type':'post','url_action':'/process/complete/camunda_process/processo_richiesta_persona'},'type':'button','saveOnEnter':False,'input':True,'hideOnChildrenHidden':False}],'width':4,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':4},{'components':[],'size':'md','width':4,'currentWidth':4}],'key':'columns2','type':'columns','input':False,'tableView':False},{'title':'Sys','collapsible':False,'hidden':True,'key':'sys','type':'panel','label':'Panel','input':False,'tableView':False,'components':[{'label':'Columns','columns':[{'components':[{'label':'Process ID','applyMaskOn':'change','hidden':True,'tableView':True,'validateWhenHidden':False,'key':'process_id','properties':{'readonly':'y'},'type':'textfield','input':True},{'label':'Richiesta Persona','widget':'choicesjs','hidden':True,'tableView':False,'dataSrc':'url','data':{'url':'/models/distinct','headers':[{'key':'','value':''}]},'validateWhenHidden':False,'key':'richiesta_persona','properties':{'id':'rec_name','label':'rec_name','domain':'{}','model':'richiesta_persona','readonly':'y'},'type':'select','disableLimit':False,'noRefreshOnScroll':False,'input':True,'hideOnChildrenHidden':False},{'label':'Stato','widget':'choicesjs','hidden':True,'tableView':False,'defaultValue':'nuovo','data':{'values':[{'label':'Nuovo','value':'nuovo'},{'label':'Inserimento','value':'inserimento'},{'label':'Aggiornamento','value':'aggiornamento'}]},'validateWhenHidden':False,'key':'stato','type':'select','input':True}],'width':6,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':6},{'components':[{'label':'Persona','widget':'choicesjs','hidden':True,'tableView':False,'dataSrc':'url','data':{'url':'/models/distinct','headers':[{'key':'','value':''}]},'validateWhenHidden':False,'key':'persona','properties':{'id':'rec_name','label':'title','domain':'{}','model':'persona','readonly':'y','compute_label':'nome_completo'},'type':'select','disableLimit':False,'noRefreshOnScroll':False,'input':True,'hideOnChildrenHidden':False},{'label':'Persona Ente Azienda','applyMaskOn':'change','hidden':True,'tableView':True,'validateWhenHidden':False,'key':'persona_ente_azienda','properties':{'readonly':'y'},'type':'textfield','input':True},{'label':'Persona Classificazione','applyMaskOn':'change','hidden':True,'tableView':True,'validateWhenHidden':False,'key':'persona_classificazione','properties':{'readonly':'y'},'type':'textfield','input':True},{'label':'Persona Referente Interno','applyMaskOn':'change','hidden':True,'tableView':True,'validateWhenHidden':False,'key':'persona_referenteInterno','properties':{'readonly':'y'},'type':'textfield','input':True}],'width':6,'offset':0,'push':0,'pull':0,'size':'md','currentWidth':6}],'key':'columns3','type':'columns','input':False,'tableView':False},{'label':'Classificazione','reorder':False,'addAnotherPosition':'bottom','layoutFixed':False,'enableRowGroups':False,'initEmpty':False,'hidden':True,'tableView':False,'defaultValue':[{'code':'','label':''}],'validateWhenHidden':False,'key':'classificazione_resource','type':'datagrid','input':True,'components':[{'label':'Codice','applyMaskOn':'change','tableView':True,'validateWhenHidden':False,'key':'code','properties':{'readonly':'y'},'type':'textfield','input':True},{'label':'Label','applyMaskOn':'change','tableView':True,'validateWhenHidden':False,'key':'label','properties':{'readonly':'y'},'type':'textfield','input':True}]}]}]`;

    component.previewColumns = ['rec_name', 'components'];
    component.previewRows = [{
      __sourceRow: 2,
      rec_name: 'row-real',
      components: realComponentsPayload
    }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'demo.model',
      jasmine.objectContaining({
        rec_name: 'row-real',
        components: jasmine.arrayContaining([
          jasmine.objectContaining({
            key: 'pnl_cf',
            title: 'CF',
            type: 'panel',
            collapsible: false,
            hideLabel: true
          }),
          jasmine.objectContaining({
            key: 'pnl_classificazione',
            title: 'Classificazione',
            type: 'panel'
          })
        ])
      })
    );

    const importedPayload = apiMock.importData.calls.mostRecent().args[1] as any;
    const importedComponents = importedPayload.components as any[];
    expect(Array.isArray(importedComponents)).toBeTrue();
    expect(importedComponents.length).toBe(4);
    expect(importedComponents[0].logic[0].actions[0].state).toBeTrue();
    expect(importedComponents[1].components[0].html).toContain("form.stato == 'inserimento'");
    expect(importedComponents[2].columns[1].components[0].key).toBe('aggiungi_doc_pagamento');
    expect(importedComponents[3].components[1].hidden).toBeTrue();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should import a real component json file through the raw import endpoint', async () => {
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };
    const file = new File(
      [JSON.stringify([realComponentImportRow()])],
      '00_component.json',
      { type: 'application/json' }
    );

    await (component as any).loadPreview(file);
    await component.submitImport();

    const importedPayload = apiMock.importData.calls.mostRecent().args[1] as any;

    expect(apiMock.importData).toHaveBeenCalledWith('component', jasmine.any(Object));
    expect(Object.keys(importedPayload)).toContain('components');
    expect(Object.keys(importedPayload)).not.toContain('_id');
    expect(Object.keys(importedPayload)).not.toContain('status');
    expect(Object.keys(importedPayload)).not.toContain('data_value');
    expect(importedPayload.rec_name).toBe('classificazione_persona');
    expect(importedPayload.components.length).toBe(2);
    expect(importedPayload.components[0].columns[0].components[0].defaultValue).toBeFalse();
    expect(importedPayload.properties).toEqual(jasmine.objectContaining({
      rheader: '1',
      queryformeditable: '{}'
    }));
    expect(importedPayload.app_code).toBe('');
    expect(importedPayload._id).toBeUndefined();
    expect(importedPayload.status).toBeUndefined();
    expect(importedPayload.data_value).toBeUndefined();
    expect(apiMock.getRecordSchema).toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should import a real component spreadsheet row through the raw import endpoint', async () => {
    const originalXlsx = window.XLSX;
    const row = realComponentImportRow();
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };
    window.XLSX = {
      read: () => ({
        SheetNames: ['Import Template'],
        Sheets: { 'Import Template': {} }
      }),
      write: () => new Uint8Array(),
      utils: {
        sheet_to_json: () => [{
          ...row,
          app_code: '',
          active: 'True',
          default: 'False',
          links: "{'self':'/form/classificazione_persona'}",
          settings: "{'theme':'italia'}",
          properties: "{'rheader':'1','queryformeditable':'{}'}"
        }],
        json_to_sheet: () => ({}),
        aoa_to_sheet: () => ({}),
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: () => undefined
      }
    };

    try {
      const file = new File([new Uint8Array([1])], '00_component.xlsx');

      await (component as any).loadPreview(file);
      await component.submitImport();

      const importedPayload = apiMock.importData.calls.mostRecent().args[1] as any;

      expect(importedPayload.rec_name).toBe('classificazione_persona');
      expect(importedPayload.components.length).toBe(2);
      expect(importedPayload.links).toEqual({ self: '/form/classificazione_persona' });
      expect(importedPayload.settings).toEqual({ theme: 'italia' });
      expect(importedPayload.properties).toEqual(jasmine.objectContaining({
        rheader: '1',
        queryformeditable: '{}'
      }));
      expect(importedPayload.app_code).toBe('');
      expect(importedPayload.active).toBeTrue();
      expect(importedPayload.default).toBeFalse();
      expect(importedPayload._id).toBeUndefined();
      expect(apiMock.getRecordSchema).toHaveBeenCalled();
      expect(component.panelMessage).toContain('Import completato: 1');
    } finally {
      window.XLSX = originalXlsx;
    }
  });

  it('should import component rows through the import endpoint', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true },
        { type: 'textfield', key: 'tags', input: true },
        { type: 'textfield', key: 'authenticate', input: true }
      ]
    });
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

    expect(apiMock.importData).toHaveBeenCalledWith(
      'component',
      jasmine.objectContaining({
        rec_name: 'row-1',
        tags: [],
        authenticate: false
      })
    );
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should sanitize component form exports before posting them to the import endpoint', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true },
        { type: 'textfield', key: 'title', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };

    const previewRow = {
      rec_name: 'nullaOstaBandiRequest',
      title: 'Richiesta nulla osta bandi',
      path: '',
      parent: '',
      parent_name: '',
      type: 'form',
      display: '',
      action: '',
      authenticate: true,
      active: true,
      default: false,
      sys: false,
      demo: false,
      app_code: '',
      data_model: '',
      components: "[{'type':'textfield','key':'call_title','label':'Nome formale call','input':true,'layout':{'width':6,'offset':0,'push':0,'pull':0,'size':'md'}}]",
      properties: "{'rheader': '1', 'rfooter': '0', 'sort': 'list_order:desc,', 'queryformeditable': '{}'}",
      settings: "{'theme':'italia'}",
      links: "{'self':'/form/nullaOstaBandiRequest'}",
      data_value: '{}',
      status: 'ok',
      message: '',
      tz: 'Europe/Rome',
      owner_name: 'Admin',
      create_datetime: '2026-05-11T15:49:48Z'
    };

    component.previewColumns = Object.keys(previewRow);
    component.previewRows = [previewRow];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'component',
      jasmine.objectContaining({
        rec_name: 'nullaOstaBandiRequest',
        title: 'Richiesta nulla osta bandi',
        path: '',
        parent: '',
        parent_name: '',
        type: 'form',
        display: '',
        action: '',
        authenticate: true,
        active: true,
        default: false,
        sys: false,
        app_code: '',
        data_model: '',
        components: [
          jasmine.objectContaining({
            type: 'textfield',
            key: 'call_title',
            layout: jasmine.objectContaining({
              push: 0
            })
          })
        ],
        properties: jasmine.objectContaining({
          rheader: '1',
          rfooter: '0',
          sort: 'list_order:desc,',
          queryformeditable: '{}'
        }),
        settings: jasmine.objectContaining({
          theme: 'italia'
        }),
        links: jasmine.objectContaining({
          self: '/form/nullaOstaBandiRequest'
        })
      })
    );

    const importedPayload = apiMock.importData.calls.mostRecent().args[1] as any;
    expect(importedPayload.data_value).toBeUndefined();
    expect(importedPayload.status).toBeUndefined();
    expect(importedPayload.message).toBeUndefined();
    expect(importedPayload.tz).toBeUndefined();
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should normalize component lists that contain stringified component entries', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };

    const nestedStringifiedComponents = JSON.stringify([
      JSON.stringify({
        type: 'select',
        key: 'edu_qualification',
        label: 'Titolo di studio',
        input: true
      }),
      JSON.stringify({
        type: 'columns',
        key: 'persona_work_info_columns',
        input: false,
        columns: [
          {
            components: [
              JSON.stringify({
                type: 'checkbox',
                key: 'freshman',
                label: 'Matricola',
                input: true
              })
            ],
            width: 6
          }
        ]
      }),
      JSON.stringify({
        type: 'select',
        key: 'tipoBadge',
        label: 'Tipo badge',
        input: true
      })
    ]);

    component.previewColumns = ['rec_name', 'components'];
    component.previewRows = [{
      __sourceRow: 4,
      rec_name: 'persona_work_info',
      components: nestedStringifiedComponents
    }];

    await component.submitImport();

    const importedPayload = apiMock.importData.calls.mostRecent().args[1] as any;
    expect(Array.isArray(importedPayload.components)).toBeTrue();
    expect(importedPayload.components[0]).toEqual(jasmine.objectContaining({
      key: 'edu_qualification',
      type: 'select'
    }));
    expect(importedPayload.components[1]).toEqual(jasmine.objectContaining({
      key: 'persona_work_info_columns',
      type: 'columns'
    }));
    expect(importedPayload.components[1].columns[0].components[0]).toEqual(jasmine.objectContaining({
      key: 'freshman',
      type: 'checkbox'
    }));
    expect(importedPayload.components[2]).toEqual(jasmine.objectContaining({
      key: 'tipoBadge',
      type: 'select'
    }));
    expect(component.panelMessage).toContain('Import completato: 1');
  });

  it('should forward malformed structured fields to the import endpoint without blocking', async () => {
    apiMock.getRecordSchema.and.resolveTo({
      components: [
        { type: 'textfield', key: 'rec_name', input: true }
      ]
    });
    component.importConfig = {
      visible: true,
      model: 'component',
      title: 'Import Data'
    };
    component.previewColumns = ['rec_name', 'properties'];
    component.previewRows = [{
      __sourceRow: 7,
      rec_name: 'broken-component',
      properties: "{'broken': "
    }];

    await component.submitImport();

    expect(apiMock.importData).toHaveBeenCalledWith(
      'component',
      jasmine.objectContaining({
        rec_name: 'broken-component',
        properties: "{'broken': "
      })
    );
    expect(apiMock.updateRecord).not.toHaveBeenCalled();
    expect(component.panelError).toBeFalse();
    expect(component.panelMessage).toContain('Import completato: 1');
  });
});
