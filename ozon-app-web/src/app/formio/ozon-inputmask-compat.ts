import Inputmask from 'inputmask';

/**
 * Keeps Form.io's two mask consumers in agreement.
 *
 * A textfield `inputMask` is read twice, by different code paths:
 *  - the renderer builds `new Inputmask(inputMask)` (TextField.setInputMask),
 *    where the constructor treats a bare string as `options.alias` and resolves
 *    it against `Inputmask.prototype.aliases`;
 *  - the validator calls `Inputmask.isValid(value, { mask: inputMask })`
 *    (@formio/core validateMask), where `resolveAlias` only ever runs on
 *    `alias` — so an alias name is taken as a literal mask.
 *
 * The result is that a form using an alias (`"inputMask": "mac"`) renders
 * correctly and then rejects every value with "does not match the mask". This
 * module patches the shared `Inputmask` singleton so both sides resolve aliases
 * the same way.
 */
let installed = false;

/**
 * A single hex digit. Free in the stock definition set (`9 a * A & #`).
 *
 * Unlike the stock `#`, this carries no `casing: 'upper'`. Casing is applied
 * while typing but *not* inside `isValid`, so a `#`-based mask rejects
 * lowercase values already stored in the backend while displaying them
 * uppercased — an error the user cannot see or correct.
 */
const HEX_DIGIT = { validator: '[0-9A-Fa-f]' };

/**
 * Stock `mac` is `##:##:##:##:##:##`, which inherits the casing problem above.
 * Redefining it with {@link HEX_DIGIT} keeps every existing
 * `"inputMask": "mac"` working and makes validation case-insensitive; the
 * renderer resolves the same alias, so design and viewer stay aligned.
 *
 * Deliberate trade-off: this also drops the uppercasing the stock alias applied
 * while typing, so MAC addresses are stored in whatever case the user typed.
 * The two cannot be combined — `casing` at alias level makes `isValid` reject
 * everything, and at definition level it is ignored by `isValid`, which is the
 * asymmetry that caused the original bug. Tolerant validation was chosen
 * because a value the validator rejects is an error the user cannot see or fix.
 * Anything comparing these values downstream must be case-insensitive.
 */
const ALIAS_OVERRIDES = {
  mac: { mask: 'HH:HH:HH:HH:HH:HH' }
};

/**
 * Wraps `Inputmask.isValid` so that a mask which is really an alias name is
 * resolved as one. Anything else is passed through untouched, so literal masks
 * keep their exact semantics.
 */
function installAliasAwareValidation(): void {
  const originalIsValid = Inputmask.isValid.bind(Inputmask);
  Inputmask.isValid = (value: string, options: { mask?: string; alias?: string }): boolean => {
    if (options && !options.alias && typeof options.mask === 'string' && Inputmask.prototype.aliases[options.mask]) {
      const resolved: { mask?: string; alias?: string } = { ...options, alias: options.mask };
      delete resolved.mask;
      return originalIsValid(value, resolved);
    }
    return originalIsValid(value, options);
  };
}

export function installOzonInputmaskCompat(): void {
  if (installed) return;
  Inputmask.extendDefinitions({ H: HEX_DIGIT });
  Inputmask.extendAliases(ALIAS_OVERRIDES);
  installAliasAwareValidation();
  installed = true;
}
