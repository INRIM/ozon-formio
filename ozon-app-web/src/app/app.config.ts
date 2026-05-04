import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { provideDesignAngularKit } from 'design-angular-kit';
import { FORMIO_CONFIG, FormioAppConfig } from '@formio/angular';
import Aura from '@primeuix/themes/aura';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';
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
    // URL routing is handled by AppComponent (history + action router endpoints).
    // Disable Angular Router initial navigation to avoid NG04002 on /dashboard,/action/*.
    provideRouter(routes, withDisabledInitialNavigation()),
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimationsAsync(),
    provideDesignAngularKit(),
    { provide: FORMIO_CONFIG, useFactory: buildFormioConfig, deps: [RuntimeConfigService] },
    FormioAppConfig,
    providePrimeNG({
      ripple: true,
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: ':root[data-theme="dark"]'
        }
      }
    })
  ]
};
