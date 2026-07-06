import { AppFormioBuilderService } from './app-formio-builder.service';
import { AppFormioRendererService } from './app-formio-renderer.service';
import { AppManagerService } from './app-manager.service';
import { OzonApiService } from '../core/ozon-api.service';

describe('AppFormioBuilderService', () => {
  let service: AppFormioBuilderService;
  let renderer: AppFormioRendererService;

  beforeEach(() => {
    const api = jasmine.createSpyObj<OzonApiService>('OzonApiService', ['resolveApiUrl', 'getRecordSchema']);
    renderer = new AppFormioRendererService(api);
    const appManager = {} as AppManagerService;
    service = new AppFormioBuilderService(api, renderer, appManager);
  });

  describe('autoFillRecNameFromTitle', () => {
    it('auto-fills rec_name in snake_case from title when rec_name is empty (fires on title blur/tab)', () => {
      renderer.formSubmission = { data: { title: '', rec_name: '' } };
      service.updateFormEditorField('title', 'Nuova Anagrafica Cliente');
      service.autoFillRecNameFromTitle();
      expect(service.formEditorData['title']).toBe('Nuova Anagrafica Cliente');
      expect(service.formEditorData['rec_name']).toBe('nuova_anagrafica_cliente');
    });

    it('reflects the full title typed across several keystrokes, since input events do not trigger the fill themselves', () => {
      renderer.formSubmission = { data: { title: '', rec_name: '' } };
      'Nuova Anagrafica'.split('').forEach((_, i) => {
        service.updateFormEditorField('title', 'Nuova Anagrafica'.slice(0, i + 1));
      });
      service.autoFillRecNameFromTitle();
      expect(service.formEditorData['rec_name']).toBe('nuova_anagrafica');
    });

    it('does not overwrite an already-populated rec_name when title changes', () => {
      renderer.formSubmission = { data: { title: 'Old Title', rec_name: 'custom_rec_name' } };
      service.updateFormEditorField('title', 'Brand New Title');
      service.autoFillRecNameFromTitle();
      expect(service.formEditorData['rec_name']).toBe('custom_rec_name');
    });

    it('strips accents and collapses punctuation when slugifying', () => {
      renderer.formSubmission = { data: { title: '', rec_name: '' } };
      service.updateFormEditorField('title', "Città  --  Città's Ánagrafica!!");
      service.autoFillRecNameFromTitle();
      expect(service.formEditorData['rec_name']).toBe('citta_citta_s_anagrafica');
    });

    it('does nothing when title is empty', () => {
      renderer.formSubmission = { data: { title: '', rec_name: '' } };
      service.autoFillRecNameFromTitle();
      expect(service.formEditorData['rec_name']).toBe('');
    });
  });

  describe('updateFormEditorProperty', () => {
    it('persists sort into properties so it survives a save round-trip, while still mirroring it at top level for display', () => {
      renderer.formSubmission = { data: { properties: { rheader: '1' } } };
      service.updateFormEditorProperty('sort', 'nome:asc,');
      expect(service.formEditorProperties['sort']).toBe('nome:asc,');
      expect(service.formEditorProperties['rheader']).toBe('1');
      expect(service.formEditorData['sort']).toBe('nome:asc,');
    });

    it('persists queryformeditable into properties so it survives a save round-trip', () => {
      renderer.formSubmission = { data: { properties: {} } };
      service.updateFormEditorProperty('queryformeditable', '{"active":true}');
      expect(service.formEditorProperties['queryformeditable']).toBe('{"active":true}');
      expect(service.formEditorData['queryformeditable']).toBe('{"active":true}');
    });
  });
});
