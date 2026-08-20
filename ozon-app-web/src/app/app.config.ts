import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { APP_INITIALIZER, ApplicationConfig, ApplicationRef, ErrorHandler } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideDesignAngularKit } from 'design-angular-kit';
import { FORMIO_CONFIG, FormioAppConfig } from '@formio/angular';
import { GlobalErrorHandler } from './core/global-error-handler';
import { RuntimeConfigService } from './core/runtime-config.service';

function buildFormioConfig(runtimeConfig: RuntimeConfigService): { apiUrl: string; appUrl: string } {
  const config = runtimeConfig.getConfig();
  const baseUrl = config.useProxy ? '/api' : config.backendUrl.replace(/\/+$/, '');
  return {
    apiUrl: baseUrl,
    appUrl: baseUrl
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    GlobalErrorHandler,
    { provide: ErrorHandler, useExisting: GlobalErrorHandler },
    // Wire ApplicationRef into GlobalErrorHandler after the app is bootstrapped.
    {
      provide: APP_INITIALIZER,
      useFactory: (handler: GlobalErrorHandler, appRef: ApplicationRef) => () => {
        handler.setAppRef(appRef);
      },
      deps: [GlobalErrorHandler, ApplicationRef],
      multi: true
    },
    // URL routing is handled by AppComponent (history + action router endpoints).
    // Angular Router is intentionally not provided: no router-outlet/routerLink exists,
    // and an active Router with an empty route table throws NG04002 on browser back/forward.
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimationsAsync(),
    provideDesignAngularKit(),
    { provide: FORMIO_CONFIG, useFactory: buildFormioConfig, deps: [RuntimeConfigService] },
    FormioAppConfig
  ]
};
