import { buildOzonFormBuilderOptions } from './formio-builder-config';

describe('buildOzonFormBuilderOptions', () => {
  it('should keep Formio file fields compatible with backend-managed storage', () => {
    const options = buildOzonFormBuilderOptions();
    const builder = options['builder'] as Record<string, unknown>;
    const basic = builder['basic'] as Record<string, unknown>;
    const components = basic['components'] as Record<string, unknown>;
    const file = components['file'] as Record<string, unknown>;
    const schema = file['schema'] as Record<string, unknown>;

    expect(schema['type']).toBe('file');
    expect(schema['storage']).toBeUndefined();
  });

  it('should use the Bootstrap Italia calendar icon for datetime fields', () => {
    const options = buildOzonFormBuilderOptions();
    const builder = options['builder'] as Record<string, unknown>;
    const advanced = builder['advanced'] as Record<string, unknown>;
    const components = advanced['components'] as Record<string, unknown>;
    const datetime = components['datetime'] as Record<string, unknown>;

    expect(datetime['icon']).toBe('it-calendar');
  });

  it('should include the process panel component preset', () => {
    const options = buildOzonFormBuilderOptions();
    const builder = options['builder'] as Record<string, unknown>;
    const basic = builder['basic'] as Record<string, unknown>;
    const components = basic['components'] as Record<string, unknown>;
    const processPanel = components['processPanel'] as Record<string, unknown>;
    const schema = processPanel['schema'] as Record<string, unknown>;
    const panelComponents = schema['components'] as Array<Record<string, unknown>>;
    const firstColumns = panelComponents[0]['columns'] as Array<Record<string, unknown>>;
    const secondColumns = panelComponents[1]['columns'] as Array<Record<string, unknown>>;

    expect(processPanel['title']).toBe('Process Panel');
    expect(schema['type']).toBe('panel');
    expect((firstColumns[0]['components'] as Array<Record<string, unknown>>)[0]['key']).toBe('process_id');
    expect((firstColumns[1]['components'] as Array<Record<string, unknown>>)[0]).toEqual(jasmine.objectContaining({
      key: 'process_start',
      type: 'button',
      properties: jasmine.objectContaining({
        btn_action_type: 'post',
        url_action: 'gateway/camunda/start/Test_Process?update_data=True'
      })
    }));
    expect((firstColumns[1]['components'] as Array<Record<string, unknown>>)[1]).toEqual(jasmine.objectContaining({
      key: 'assignee',
      dataSrc: 'resource',
      properties: { readonly: 'y' }
    }));
    expect((secondColumns[0]['components'] as Array<Record<string, unknown>>)[0]['key']).toBe('process_complete');
    expect((secondColumns[1]['components'] as Array<Record<string, unknown>>)[0]['key']).toBe('process_approve');
    expect((secondColumns[2]['components'] as Array<Record<string, unknown>>)[0]['key']).toBe('process_refuse');
  });
});
