import { registerEvaluator as registerCoreEvaluator } from '@formio/core';
import { DefaultEvaluator as FormioDefaultEvaluator, Formio } from '@formio/js';
import Quill from 'quill';
import { ozonFileTemplate } from './ozon-file-template';
import { installOzonJsonEditorFormioComponent } from './ozon-json-editor-formio';

/**
 * Form.io ships builder edit-form callbacks in both modern context-object form
 * and legacy positional-args form. The core evaluator only passes the context
 * object, which breaks legacy callbacks such as TextField.edit.display.widget.
 */
let formioCtxLogCount = 0;
const FORMIO_CTX_LOG_LIMIT = 15;

export class LegacyCompatibleFormioEvaluator extends FormioDefaultEvaluator {
  override execute(func: (...args: any[]) => any, args: any, context: any = {}, options: any = {}): any {
    const normalizedOptions = options && typeof options === 'object' ? options : { noeval: options };
    // DEBUG: dump the variable bag Form.io exposes to native logic / calculateValue / conditional.
    if (args && typeof args === 'object' && !Array.isArray(args) && formioCtxLogCount < FORMIO_CTX_LOG_LIMIT) {
      formioCtxLogCount++;
      console.log('[formio-logic] variabili disponibili (keys):', Object.keys(args));
      console.log('[formio-logic] data:', args.data, 'row:', args.row);
      console.log('[formio-logic] component.key:', args?.component?.key, 'value:', args.value);
      console.log('[formio-logic] form/user/is_admin/session:', args.form, args.user, args.is_admin, args.session);
      console.log('[formio-logic] context completo:', args);
      if (formioCtxLogCount === FORMIO_CTX_LOG_LIMIT) console.log('[formio-logic] (log limitato ai primi', FORMIO_CTX_LOG_LIMIT, 'eval per non floodare)');
    }
    if (!Array.isArray(args) && args && typeof args === 'object' && typeof func === 'function' && func.length > 1) {
      if (this.noeval || normalizedOptions.noeval) {
        console.warn('No evaluations allowed for this renderer.');
        return;
      }
      return func.apply(context, [
        args.value,
        args.component,
        args.row,
        args.data,
        args.instance,
        args.form,
        args.options,
        args.path,
        args.scope
      ]);
    }
    return super.execute(func, args, context, normalizedOptions);
  }
}

let installed = false;

export function installFormioCompatibility(): void {
  if (installed) return;
  const evaluator = new LegacyCompatibleFormioEvaluator();
  registerCoreEvaluator(evaluator);
  Formio.use({ evaluator });
  // Override the `file` component markup with the Bootstrap Italia v2 upload widget.
  const templates = (Formio as unknown as { Templates?: { addTemplates?: (t: unknown) => void } }).Templates;
  templates?.addTemplates?.({ bootstrap: { file: { form: ozonFileTemplate } } });
  installOzonJsonEditorFormioComponent();
  if (typeof window !== 'undefined') {
    (window as Window & { Quill?: typeof Quill }).Quill = Quill;
  }
  installed = true;
}
