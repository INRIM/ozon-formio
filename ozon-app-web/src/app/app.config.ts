import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { provideDesignAngularKit } from 'design-angular-kit';
import Aura from '@primeuix/themes/aura';
import { providePrimeNG } from 'primeng/config';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // URL routing is handled by AppComponent (history + action router endpoints).
    // Disable Angular Router initial navigation to avoid NG04002 on /dashboard,/action/*.
    provideRouter(routes, withDisabledInitialNavigation()),
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimationsAsync(),
    provideDesignAngularKit(),
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
