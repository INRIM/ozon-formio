import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RecordListComponent } from './record-list.component';
import { RecordTransferToolsComponent } from './record-transfer-tools.component';
import { OzonApiService } from '../core/ozon-api.service';

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
});
