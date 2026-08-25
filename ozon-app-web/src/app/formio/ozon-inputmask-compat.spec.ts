import { Formio } from '@formio/js';
import Inputmask from 'inputmask';
import { installOzonInputmaskCompat } from './ozon-inputmask-compat';

const MAC_MASK = 'HH:HH:HH:HH:HH:HH';

/**
 * Builds a real Form.io form and asks it to validate, so the assertions go
 * through the bundled @formio/core validator rather than a hand-rolled call.
 * That is the only way to prove the patched `Inputmask` singleton is the same
 * object @formio/core resolves once esbuild has done its CJS/ESM interop.
 */
async function validateThroughFormio(
  inputMask: string,
  value: string
): Promise<{ valid: boolean; value: unknown }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    const form = await Formio.createForm(host, {
      components: [
        {
          label: 'Indirizzo fisico della scheda di rete (LAN)',
          key: 'mac_lan',
          type: 'textfield',
          inputMask,
          applyMaskOn: 'change',
          input: true
        }
      ]
    });
    // Assigning `form.submission` settles asynchronously; awaiting
    // setSubmission is what guarantees the value reached the component before
    // we validate it.
    await form.setSubmission({ data: { mac_lan: value } });
    const data = form.data;
    return { valid: form.checkValidity(data, true, data), value: data.mac_lan };
  } finally {
    host.remove();
  }
}

describe('ozon inputmask compat', () => {
  beforeAll(() => {
    installOzonInputmaskCompat();
  });

  it('registers the hex definition without clobbering the stock ones', () => {
    expect(Inputmask.prototype.definitions['H']).toBeDefined();
    for (const stock of ['9', 'a', '*', 'A', '&', '#']) {
      expect(Inputmask.prototype.definitions[stock]).toBeDefined();
    }
  });

  it('accepts a MAC address in either case', () => {
    expect(Inputmask.isValid('00:1A:2B:3C:4D:5E', { mask: MAC_MASK })).toBeTrue();
    expect(Inputmask.isValid('00:1a:2b:3c:4d:5e', { mask: MAC_MASK })).toBeTrue();
  });

  it('rejects non-hex digits, wrong separators and wrong length', () => {
    expect(Inputmask.isValid('ZZ:ZZ:ZZ:ZZ:ZZ:ZZ', { mask: MAC_MASK })).toBeFalse();
    expect(Inputmask.isValid('00-1A-2B-3C-4D-5E', { mask: MAC_MASK })).toBeFalse();
    expect(Inputmask.isValid('001A2B3C4D5E', { mask: MAC_MASK })).toBeFalse();
    expect(Inputmask.isValid('00:1A:2B:3C:4D', { mask: MAC_MASK })).toBeFalse();
  });

  it('resolves an alias name handed over as a literal mask', () => {
    // What @formio/core does: Inputmask.isValid(value, { mask: component.inputMask }).
    // Without the shim "mac" is a three-character literal mask and no MAC passes.
    expect(Inputmask.isValid('00:1A:2B:3C:4D:5E', { mask: 'mac' })).toBeTrue();
    expect(Inputmask.isValid('ZZ:ZZ:ZZ:ZZ:ZZ:ZZ', { mask: 'mac' })).toBeFalse();
  });

  it('leaves the other built-in aliases working', () => {
    expect(Inputmask.isValid('192.168.1.1', { mask: 'ip' })).toBeTrue();
    expect(Inputmask.isValid('999.999.999.999', { mask: 'ip' })).toBeFalse();
    expect(Inputmask.isValid('a@b.it', { mask: 'email' })).toBeTrue();
    expect(Inputmask.isValid('nonvale', { mask: 'email' })).toBeFalse();
  });

  it('leaves literal masks untouched', () => {
    expect(Inputmask.isValid('123-456', { mask: '999-999' })).toBeTrue();
    expect(Inputmask.isValid('abc-def', { mask: '999-999' })).toBeFalse();
  });

  it('makes the overridden mac alias case-insensitive', () => {
    expect(Inputmask.isValid('00:1a:2b:3c:4d:5e', { mask: 'mac' })).toBeTrue();
  });

  // Pins the accepted trade-off: dropping `casing: 'upper'` from the stock mac
  // alias is what buys the tolerant validation above, and it means typed input
  // keeps its case instead of being normalised. Downstream consumers of these
  // values have to compare case-insensitively.
  it('no longer uppercases a MAC while typing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      new Inputmask('mac').mask(input);
      input.value = 'aabbccddeeff';
      input.dispatchEvent(new Event('input'));
      expect(input.value).toBe('aa:bb:cc:dd:ee:ff');
    } finally {
      input.remove();
    }
  });

  // TextField.setInputMask does `new Inputmask(inputMask).mask(input)` inside a
  // try/catch that only console.warn()s, so a broken definition would fail
  // silently and leave the field unmasked. Exercise that exact call.
  it('masks a live input the way the renderer does', () => {
    const warn = spyOn(console, 'warn');
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      new Inputmask(MAC_MASK).mask(input);
      input.value = '001A2B3C4D5E';
      input.dispatchEvent(new Event('input'));
      expect(input.value).toBe('00:1A:2B:3C:4D:5E');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  // Regression guard for the reported bug: before the shim this form rejected
  // every MAC with "does not match the mask". It also pins down that the
  // patched Inputmask singleton is the object @formio/core resolves after
  // esbuild's CJS/ESM interop — a hand-rolled isValid call cannot show that.
  it('validates an alias-masked field through a real Form.io form', async () => {
    const accepted = await validateThroughFormio('mac', '00:1A:2B:3C:4D:5E');
    expect(accepted.valid).toBeTrue();
    expect(accepted.value).toBe('00:1A:2B:3C:4D:5E');
  });

  // A value loaded into the form keeps whatever the backend stored — it is not
  // run through the mask — so the validator is what has to catch junk.
  it('still rejects a value that does not fit the alias mask', async () => {
    const rejected = await validateThroughFormio('mac', 'ZZ:ZZ:ZZ:ZZ:ZZ:ZZ');
    expect(rejected.value).toBe('ZZ:ZZ:ZZ:ZZ:ZZ:ZZ');
    expect(rejected.valid).toBeFalse();
  });

  it('is idempotent', () => {
    installOzonInputmaskCompat();
    installOzonInputmaskCompat();
    expect(Inputmask.isValid('00:1A:2B:3C:4D:5E', { mask: 'mac' })).toBeTrue();
  });
});
