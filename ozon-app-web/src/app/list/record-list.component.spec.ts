import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RecordListComponent } from './record-list.component';

describe('RecordListComponent', () => {
  let fixture: ComponentFixture<RecordListComponent>;
  let component: RecordListComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordListComponent]
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
});
