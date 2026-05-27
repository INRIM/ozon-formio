import { ApplicationRef } from '@angular/core';
import { GlobalErrorHandler } from './global-error-handler';
import { GlobalErrorStateService } from './global-error-state.service';

describe('GlobalErrorHandler', () => {
  let state: GlobalErrorStateService;
  let handler: GlobalErrorHandler;

  beforeEach(() => {
    state = new GlobalErrorStateService();
    handler = new GlobalErrorHandler(state);
    document.getElementById('ozon-global-error-fallback')?.remove();
  });

  afterEach(() => {
    document.getElementById('ozon-global-error-fallback')?.remove();
  });

  it('should report the error and trigger a recovery tick', () => {
    const appRef = jasmine.createSpyObj<ApplicationRef>('ApplicationRef', ['tick']);
    handler.setAppRef(appRef);

    handler.handleError(new Error('boom'));

    expect(state.visible).toBeTrue();
    expect(state.message).toBe('boom');
    expect(appRef.tick).toHaveBeenCalledTimes(1);
  });

  it('should render a fallback overlay when recovery tick fails', () => {
    const appRef = jasmine.createSpyObj<ApplicationRef>('ApplicationRef', ['tick']);
    appRef.tick.and.throwError('tick failed');
    handler.setAppRef(appRef);

    handler.handleError(new Error('fatal client error'));

    const fallback = document.getElementById('ozon-global-error-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('fatal client error');
    expect(fallback?.textContent).toContain('Ricarica pagina');
  });
});
