import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { OzonApiService } from './core/ozon-api.service';
import { MainManagerService } from './core/main-manager.service';

describe('AppComponent next_action redirect mode', () => {
  let apiMock: jasmine.SpyObj<OzonApiService>;
  let mainManagerMock: jasmine.SpyObj<MainManagerService>;

  beforeEach(async () => {
    apiMock = jasmine.createSpyObj<OzonApiService>('OzonApiService', [
      'getNextAction',
      'getAction'
    ]);
    apiMock.getNextAction.and.resolveTo({
      mode: 'redirect',
      data: {
        next_page: '/action/form_form_list_posizione/Gov.30459'
      }
    });
    apiMock.getAction.and.resolveTo({ mode: 'action', data: { status: 'ok' } });

    mainManagerMock = jasmine.createSpyObj<MainManagerService>('MainManagerService', [
      'hardReloadToUrl'
    ]);
    mainManagerMock.hardReloadToUrl.and.returnValue({
      reloaded: true,
      blocked: false,
      targetUrl: 'http://localhost:7999/action/form_form_list_posizione/Gov.30459'
    });

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: OzonApiService, useValue: apiMock },
        { provide: MainManagerService, useValue: mainManagerMock }
      ]
    }).compileComponents();
  });

  it('should hard reload using next_page when next_action returns mode redirect', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance as any;
    app.actionManager.currentActionName = 'list_posizione';

    await app.actionManager['runNextActionRoute'](['list_posizione', 'Gov.30459']);

    expect(mainManagerMock.hardReloadToUrl).toHaveBeenCalledWith(
      '/action/form_form_list_posizione/Gov.30459'
    );
    expect(apiMock.getAction).not.toHaveBeenCalled();
  });
});
