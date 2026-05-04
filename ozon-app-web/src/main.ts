import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { installFormioCompatibility } from './app/formio/formio-compat';

installFormioCompatibility();
bootstrapApplication(AppComponent, appConfig).catch((error) => {
  console.error(error);
});
