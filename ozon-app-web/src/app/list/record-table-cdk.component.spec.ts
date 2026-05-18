import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RecordTableCdkComponent } from './record-table-cdk.component';

describe('RecordTableCdkComponent', () => {
  let fixture: ComponentFixture<RecordTableCdkComponent>;
  let component: RecordTableCdkComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordTableCdkComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RecordTableCdkComponent);
    component = fixture.componentInstance;
    component.columns = [
      { field: '__rec_name', title: 'Record' },
      { field: 'name', title: 'Nome' }
    ];
    component.rows = [
      { __rowid: 1, __rec_name: 'REC-1', name: 'Mario' }
    ];
    component.displayCell = (row, field) => String(row[field] ?? '');
    component.ngOnChanges();
  });

  it('should render row cell content in cdk table', () => {
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('REC-1');
    expect(text).toContain('Mario');
  });

  it('should emit row click when row is clicked', () => {
    const clickSpy = spyOn(component.rowClick, 'emit');

    fixture.detectChanges();
    const row = fixture.debugElement.query(By.css('.ozon-record-table__row'));
    row.triggerEventHandler('click', { target: row.nativeElement });

    expect(clickSpy).toHaveBeenCalled();
  });
});
