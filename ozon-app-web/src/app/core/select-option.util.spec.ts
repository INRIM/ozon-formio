import { selectOptionPrimitiveValue, toSelectValueOption } from './select-option.util';

describe('select-option.util', () => {
  it('should prefer rec_name over _id for ozon records by default', () => {
    const option = toSelectValueOption({
      _id: '665f0f51f2d5000011223344',
      rec_name: 'resource.form.1',
      label: 'Resource Form 1'
    });

    expect(option).toEqual(jasmine.objectContaining({
      label: 'Resource Form 1',
      value: 'resource.form.1',
      rec_name: 'resource.form.1',
      id: 'resource.form.1',
      _id: 'resource.form.1',
      data: jasmine.objectContaining({
        _id: '665f0f51f2d5000011223344',
        rec_name: 'resource.form.1'
      })
    }));
    expect(selectOptionPrimitiveValue({ _id: '665f0f51f2d5000011223344', rec_name: 'resource.form.1' })).toBe('resource.form.1');
  });

  it('should honor configured idPath-like paths including nested fields', () => {
    const option = toSelectValueOption({
      _id: 'mongo-1',
      data: {
        rec_name: 'REC-1',
        full_name: 'Record Uno'
      }
    }, {
      valuePaths: ['data.rec_name'],
      labelPaths: ['data.full_name'],
      aliasValuePaths: ['rec_name']
    });

    expect(option).toEqual(jasmine.objectContaining({
      label: 'Record Uno',
      value: 'REC-1',
      rec_name: 'REC-1',
      id: 'REC-1',
      _id: 'REC-1'
    }));
    expect(selectOptionPrimitiveValue({
      _id: 'mongo-1',
      data: { rec_name: 'REC-1' }
    }, { valuePaths: ['data.rec_name'] })).toBe('REC-1');
  });
});
