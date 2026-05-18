import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RecordCardsComponent } from './record-cards.component';

describe('RecordCardsComponent', () => {
  let fixture: ComponentFixture<RecordCardsComponent>;
  let component: RecordCardsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordCardsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(RecordCardsComponent);
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

  it('should emit selection and row click when a card is clicked', () => {
    const selectionSpy = spyOn(component.selectionChange, 'emit');
    const clickSpy = spyOn(component.rowClick, 'emit');

    fixture.detectChanges();
    const article = fixture.debugElement.query(By.css('.ozon-record-card'));
    article.triggerEventHandler('click', { target: article.nativeElement });

    expect(selectionSpy).toHaveBeenCalledWith([jasmine.objectContaining({ __rec_name: 'REC-1' })]);
    expect(clickSpy).toHaveBeenCalled();
  });
});
