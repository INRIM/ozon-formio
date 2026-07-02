import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RecordListComponent } from './record-list.component';
import { RecordTransferToolsComponent } from './record-transfer-tools.component';
import { OzonApiService } from '../core/ozon-api.service';
import { RecordTableCdkComponent } from './record-table-cdk.component';

describe('RecordListComponent', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let component: RecordListComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordListComponent],
      providers: [
        {
          provide: OzonApiService,
          useValue: jasmine.createSpyObj<OzonApiService>('OzonApiService', [
            'getAction',
            'getRecordSchema',
            'importData',
            'importClean',
            'updateRecord',
            'streamList',
            'deleteAction'
          ])
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RecordListComponent);
    component = fixture.componentInstance;
    component.tableColumns = [
      { field: '__rec_name', title: 'Record' },
      { field: 'country', title: 'Country' }
    ];
    component.tableRows = [
      { __rowid: 1, __rec_name: 'REC-1', country: 'IT' }
    ];
    component.displayCell = (row, field) => String(row[field] ?? '');
  });

  it('should render placeholders while fast search and table are warming up', () => {
    component.fastSearchLoading = true;
    component.tableRenderLoading = true;

    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.ozon-fast-search-placeholder'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.ozon-list-placeholder'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('app-record-table-cdk'))).toBeNull();
  });

  it('should not render the deprecated plain filter when fast search is not available', () => {
    fixture.detectChanges();

    const filterInput = fixture.debugElement.query(By.css('input[placeholder="Filtra righe..."]'));
    expect(filterInput).toBeNull();
    expect(fixture.debugElement.query(By.css('.ozon-fast-search-placeholder'))).toBeNull();
  });

  it('should forward import lifecycle events from transfer tools', () => {
    component.isAdmin = true;
    component.importConfig = {
      visible: true,
      model: 'demo.model',
      title: 'Import Data'
    };
    spyOn(component.importBusyChange, 'emit');
    spyOn(component.importFinished, 'emit');

    fixture.detectChanges();
    const gearButton = fixture.debugElement.query(By.css('.ozon-gear-btn'));
    gearButton.nativeElement.click();
    fixture.detectChanges();

    const transferTools = fixture.debugElement.query(By.directive(RecordTransferToolsComponent));
    const transferToolsInstance = transferTools.componentInstance as RecordTransferToolsComponent;
    transferToolsInstance.importBusyChange.emit(true);
    transferToolsInstance.importFinished.emit();

    expect(component.importBusyChange.emit).toHaveBeenCalledOnceWith(true);
    expect(component.importFinished.emit).toHaveBeenCalledTimes(1);
  });

  it('should open filter panel and emit Mongo-compatible filter rules', () => {
    component.filterConfig = {
      fields: {
        country: { name: 'Country', type: 'string' },
        qty: { name: 'Qty', type: 'number' }
      }
    };
    component.filterPreview = '{}';
    spyOn(component.filterRulesChange, 'emit');
    spyOn(component.filterApply, 'emit');

    fixture.detectChanges();
    const filterButton = fixture.debugElement.query(By.css('.ozon-filter-btn'));
    filterButton.nativeElement.click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.ozon-filter-panel'))).not.toBeNull();

    const addButton = fixture.debugElement.queryAll(By.css('.ozon-filter-actions button'))[0];
    addButton.nativeElement.click();
    fixture.detectChanges();

    expect(component.filterRulesChange.emit).toHaveBeenCalledWith({
      condition: 'and',
      rules: [jasmine.objectContaining({ field: 'country', operator: '=', value: '' })]
    });

    const applyButton = fixture.debugElement.queryAll(By.css('.ozon-filter-actions button'))[2];
    applyButton.nativeElement.click();

    expect(component.filterApply.emit).toHaveBeenCalled();
  });

  it('should not emit filter value changes on every keystroke', () => {
    component.filterConfig = {
      fields: {
        country: { name: 'Country', type: 'string' }
      }
    };
    component.filterRules = {
      condition: 'and',
      rules: [{ field: 'country', operator: 'contains', value: '' }]
    };
    component.filterOpen = true;
    spyOn(component.filterRulesChange, 'emit');

    fixture.detectChanges();

    const valueInput = fixture.debugElement.query(By.css('.ozon-filter-value')).nativeElement as HTMLInputElement;
    valueInput.value = 'ita';
    valueInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.filterRulesChange.emit).not.toHaveBeenCalled();

    valueInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.filterRulesChange.emit).toHaveBeenCalledOnceWith({
      condition: 'and',
      rules: [jasmine.objectContaining({ field: 'country', operator: 'contains', value: 'ita' })]
    });
  });

  it('should route desktop table row click to row open instead of selection click', () => {
    component.isMobile = false;
    spyOn(component.desktopRowOpen, 'emit');
    spyOn(component.rowClick, 'emit');

    fixture.detectChanges();

    const table = fixture.debugElement.query(By.directive(RecordTableCdkComponent)).componentInstance as RecordTableCdkComponent;
    const payload = { row: component.tableRows[0], event: new MouseEvent('click') };
    table.rowClick.emit(payload);

    expect(component.desktopRowOpen.emit).toHaveBeenCalledOnceWith(payload);
    expect(component.rowClick.emit).not.toHaveBeenCalled();
  });

  it('should parse and format date and datetime values correctly using toDateValue and normalizeFilterValue', () => {
    const dateObj = new Date(2026, 5, 25, 11, 40);
    expect(component.toDateValue(dateObj)).toBe(dateObj);

    const dateStr = '2026-06-25T11:40:00.000Z';
    const parsedDate = component.toDateValue(dateStr);
    expect(parsedDate).toBeInstanceOf(Date);
    expect(parsedDate?.getFullYear()).toBe(2026);

    component.filterConfig = {
      fields: {
        created_at: { name: 'Created At', type: 'datetime' }
      }
    };
    const normalizedDatetime = component['normalizeFilterValue']('created_at', dateObj);
    expect(normalizedDatetime).toBe('2026-06-25T11:40');

    component.filterConfig = {
      fields: {
        due_date: { name: 'Due Date', type: 'date' }
      }
    };
    const normalizedDate = component['normalizeFilterValue']('due_date', dateObj);
    expect(normalizedDate).toBe('2026-06-25');
  });
});
