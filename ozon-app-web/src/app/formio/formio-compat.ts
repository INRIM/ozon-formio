import { registerEvaluator as registerCoreEvaluator } from '@formio/core';
import { DefaultEvaluator as FormioDefaultEvaluator, Formio } from '@formio/js';

/**
 * Form.io ships builder edit-form callbacks in both modern context-object form
 * and legacy positional-args form. The core evaluator only passes the context
 * object, which breaks legacy callbacks such as TextField.edit.display.widget.
 */
export class LegacyCompatibleFormioEvaluator extends FormioDefaultEvaluator {
  override execute(func: (...args: any[]) => any, args: any, context: any = {}, options: any = {}): any {
    const normalizedOptions = options && typeof options === 'object' ? options : { noeval: options };
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
  installed = true;
}
