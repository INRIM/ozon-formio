import { InjectionToken, Provider } from '@angular/core';

export interface FormioBuilderExtension {
  builder?: Record<string, unknown>;
}

export const FORMIO_BUILDER_EXTENSIONS = new InjectionToken<readonly FormioBuilderExtension[]>(
  'FORMIO_BUILDER_EXTENSIONS',
  {
    factory: () => []
  }
);

export function provideFormioBuilderExtension(extension: FormioBuilderExtension): Provider {
  return {
    provide: FORMIO_BUILDER_EXTENSIONS,
    multi: true,
    useValue: extension
  };
}

export function buildOzonFormBuilderOptions(args: {
  parentModelComponents?: Record<string, unknown> | null;
  extensions?: readonly FormioBuilderExtension[];
} = {}): Record<string, unknown> {
  const builder = mergeRecords(
    createBuiltinBuilderConfig(),
    ...(args.extensions ?? []).map((extension) => asRecord(extension?.builder) ?? {})
  );
  const parentModelComponents = asRecord(args.parentModelComponents);
  if (parentModelComponents && Object.keys(parentModelComponents).length) {
    builder['modelfield'] = mergeRecords(
      {
        title: 'Parent Model Fields',
        weight: 0,
        components: {}
      },
      asRecord(builder['modelfield']) ?? {},
      { components: parentModelComponents }
    );
  }
  return {
    noDefaultSubmitButton: true,
    builder
  };
}

function createBuiltinBuilderConfig(): Record<string, unknown> {
  return deepClone({
    resource: false,
    basic: {
      components: {
        selectboxes: false,
        rec_name: {
          title: 'Field Name',
          icon: 'external-link',
          group: 'basic',
          schema: {
            label: 'Name',
            key: 'rec_name',
            type: 'textfield',
            input: true,
            hidden: false,
            tableView: true
          }
        },
        button: {
          title: 'Button',
          icon: 'stop',
          group: 'basic',
          weight: 6,
          schema: {
            label: 'Button',
            showValidations: false,
            theme: 'warning',
            block: true,
            customClass: 'btn-outline-primary',
            tableView: false,
            key: 'action1',
            properties: {
              btn_action_type: 'post',
              url_action: 'url_action'
            },
            type: 'button',
            input: true,
            hideOnChildrenHidden: false
          }
        },
        buttonalert: {
          title: 'Button Alert',
          icon: 'window-maximize',
          group: 'basic',
          weight: 10,
          schema: {
            label: 'Button Alert',
            showValidations: false,
            theme: 'warning',
            rightIcon: 'it-external-link',
            customClass: 'btn-outline-primary',
            tableView: false,
            modalEdit: true,
            key: 'buttonAlert',
            properties: {
              modal_title: 'Alert Title',
              modal_message: 'Alert Message',
              btn_modal_label: 'Yes',
              btn_action_type: 'post',
              url_action: 'url_action'
            },
            type: 'button',
            input: true,
            hideOnChildrenHidden: false
          }
        },
        buttondelete: {
          title: 'Button Delete Record',
          icon: 'trash',
          group: 'basic',
          weight: 10,
          schema: {
            label: 'Elimina',
            showValidations: false,
            theme: 'danger',
            leftIcon: 'it-delete',
            rightIcon: 'it-delete',
            customClass: 'btn-danger',
            tableView: false,
            modalEdit: true,
            key: 'elimina',
            properties: {
              modal_title: 'Attenzione',
              modal_message: 'Vuoi veramente eliminare il record?',
              btn_modal_label: 'Si',
              btn_action_type: 'post',
              url_action: 'url_action'
            },
            logic: [
              {
                name: 'delete active',
                trigger: {
                  type: 'json',
                  json: {
                    '!': [
                      {
                        and: [
                          { var: ['form.rec_name', false] },
                          { in: [{ var: 'user.uid' }, { var: 'user.allowed_users' }] },
                          { '==': [{ var: 'form.deleted' }, 0] }
                        ]
                      }
                    ]
                  }
                },
                actions: [
                  {
                    name: 'activate button',
                    type: 'property',
                    property: {
                      label: 'Hidden',
                      value: 'hidden',
                      type: 'boolean'
                    },
                    state: true
                  }
                ]
              },
              {
                name: 'compute delete url',
                trigger: {
                  type: 'json',
                  json: {
                    cat: ['/action/delete_', { var: 'form.data_model' }, '/', { var: 'form.rec_name' }]
                  }
                },
                actions: [
                  {
                    name: 'update value',
                    type: 'value',
                    value: 'url_action'
                  }
                ]
              }
            ],
            type: 'button',
            input: true,
            hideOnChildrenHidden: false
          }
        }
      }
    },
    advanced: {
      components: {
        model_list: {
          title: 'Model list',
          group: 'advanced',
          icon: 'list',
          schema: {
            label: 'Model',
            widget: 'choicesjs',
            tableView: true,
            dataSrc: 'url',
            data: {
              url: '/models/distinct',
              headers: [{ key: '', value: '' }]
            },
            validate: {
              required: true
            },
            key: 'model',
            properties: {
              id: 'rec_name',
              label: 'title',
              domain: '{}',
              model: 'component'
            },
            type: 'select',
            input: true,
            hideOnChildrenHidden: false,
            disableLimit: false
          }
        },
        tags: false,
        url: false,
        address: false,
        day: false,
        time: false,
        currency: false,
        signature: false,
        datetime: {
          title: 'Date / Time',
          group: 'advanced',
          icon: 'calendar',
          weight: 40,
          schema: {
            type: 'datetime',
            label: 'Date / Time',
            key: 'dateTime',
            format: 'd/m/Y H:i:S',
            useLocaleSettings: false,
            customClass: '',
            tableView: true,
            allowInput: true,
            enableDate: true,
            enableTime: true,
            defaultValue: '',
            defaultDate: '',
            displayInTimezone: 'viewer',
            datepickerMode: 'day',
            datePicker: {
              showWeeks: true,
              startingDay: 0,
              initDate: '',
              minMode: 'day',
              maxMode: 'year',
              yearRows: 4,
              yearColumns: 5,
              minDate: null,
              maxDate: null
            },
            timePicker: {
              hourStep: 1,
              minuteStep: 1,
              showMeridian: true,
              readonlyInput: false,
              mousewheel: true,
              arrowkeys: true
            }
          }
        },
        printdata: {
          title: 'Pulsante Stampa',
          group: 'advanced',
          icon: 'print',
          weight: 50,
          schema: {
            label: 'Stampa',
            tag: 'a',
            attrs: [
              { attr: 'target', value: '_blank' },
              { attr: 'icon', value: 'it-print' }
            ],
            content: 'stampa',
            refreshOnChange: false,
            customClass: 'mx-auto col-md-8 mt-1 mb-1 btn',
            key: 'ilink',
            logic: [
              {
                name: 'url maker',
                trigger: {
                  type: 'json',
                  json: {
                    cat: [
                      '/client/print/form/',
                      { var: 'form.data_model' },
                      '/',
                      { var: 'form.rec_name' }
                    ]
                  }
                },
                actions: [
                  {
                    name: 'make content',
                    type: 'value',
                    value: 'content'
                  }
                ]
              }
            ],
            type: 'htmlelement',
            input: false,
            tableView: false
          }
        },
        editor: {
          title: 'Editor',
          group: 'advanced',
          icon: 'paragraph',
          schema: {
            html: '<p>Testo</p>',
            label: 'Editor',
            refreshOnChange: false,
            key: 'editor',
            properties: {
              editor: 'active'
            },
            type: 'content',
            input: false,
            tableView: false
          }
        },
        jsoneditor: {
          title: 'JsonEditor',
          group: 'advanced',
          icon: 'align-left',
          schema: {
            label: 'Text Area',
            autoExpand: false,
            tableView: false,
            inputFormat: 'plain',
            defaultValue: '{}',
            key: 'textArea',
            properties: {
              type: 'json'
            },
            type: 'textarea',
            input: true
          }
        },
        admin_todo: {
          title: 'Todo Supervised',
          group: 'advanced',
          icon: 'list-ul',
          schema: {
            legend: 'Supervised Todo',
            key: 'supervised_todo',
            properties: {
              rec_name: 'supervised_todo',
              action_type: 'task',
              type: 'data',
              mode: 'form',
              admin: 'true'
            },
            type: 'fieldset',
            label: 'Supervised Todo',
            input: false,
            tableView: false,
            components: [
              {
                label: 'Fatto',
                showValidations: false,
                theme: 'warning',
                block: true,
                customClass: 'btn-outline-primary',
                tableView: false,
                key: 'btn_admin_todo',
                properties: {
                  btn_action_type: 'post',
                  url_action: '/action/_model/supervised_todo',
                  leftIcon: 'it-check-circle'
                },
                logic: [
                  {
                    name: 'check',
                    trigger: {
                      type: 'json',
                      json: { '==': [1, 1] }
                    },
                    actions: [
                      {
                        name: 'set visible',
                        type: 'value',
                        value: 'hidden={"!":[{"and":[{"var":["form.todo", false]},{"var":["is_admin", false]}]}]}'
                      }
                    ]
                  },
                  {
                    name: 'eval url',
                    trigger: {
                      type: 'json',
                      json: {
                        cat: ['/action/', { var: 'app.curr_model' }, '_supervised_todo', '/', { var: 'form.rec_name' }]
                      }
                    },
                    actions: [
                      {
                        name: 'set value',
                        type: 'value',
                        value: 'url_action'
                      }
                    ]
                  }
                ],
                type: 'button',
                input: true,
                hideOnChildrenHidden: false,
                saveOnEnter: false
              },
              {
                label: 'Todo',
                hidden: true,
                tableView: false,
                defaultValue: false,
                calculateValue: 'eval_data',
                calculateServer: true,
                key: 'todo',
                type: 'checkbox',
                input: true
              }
            ]
          }
        },
        user_todo: {
          title: 'Todo User',
          group: 'advanced',
          icon: 'list-ul',
          schema: {
            legend: 'User Todo',
            key: 'user_todo',
            properties: {
              rec_name: 'user_todo',
              action_type: 'task',
              type: 'data',
              mode: 'form'
            },
            type: 'fieldset',
            label: 'User Todo',
            input: false,
            tableView: false,
            components: [
              {
                label: 'Fatto',
                showValidations: false,
                theme: 'warning',
                block: true,
                customClass: 'btn-outline-primary',
                tableView: false,
                key: 'btn_user_todo',
                properties: {
                  btn_action_type: 'post',
                  url_action: '/action/model/submit_test_todo',
                  leftIcon: 'it-check-circle'
                },
                logic: [
                  {
                    name: 'check',
                    trigger: {
                      type: 'json',
                      json: { '==': [1, 1] }
                    },
                    actions: [
                      {
                        name: 'set visible',
                        type: 'value',
                        value: 'hidden={"!":{"var":["form.todo", false]}}'
                      }
                    ]
                  },
                  {
                    name: 'eval url',
                    trigger: {
                      type: 'json',
                      json: {
                        cat: ['/action/', { var: 'app.curr_model' }, '_user_todo', '/', { var: 'form.rec_name' }]
                      }
                    },
                    actions: [
                      {
                        name: 'set value',
                        type: 'value',
                        value: 'url_action'
                      }
                    ]
                  }
                ],
                type: 'button',
                input: true,
                hideOnChildrenHidden: false,
                saveOnEnter: false
              },
              {
                label: 'Todo',
                hidden: true,
                tableView: false,
                defaultValue: false,
                calculateValue: 'eval_user_todo',
                calculateServer: true,
                key: 'todo',
                type: 'checkbox',
                input: true
              }
            ]
          }
        }
      }
    },
    layout: {
      components: {
        well: false,
        table: false,
        fieldset: false,
        app_link: {
          title: 'Link',
          key: 'app_link',
          icon: 'link',
          schema: {
            label: 'New Link',
            type: 'htmlelement',
            key: 'ilink',
            tag: 'a',
            content: 'https://...',
            customClass: 'mx-auto col-md-8 mt-1 mb-1',
            attrs: [
              { attr: 'target', value: '_blank' },
              { attr: 'icon', value: '' }
            ]
          }
        }
      }
    },
    data: {
      components: {
        hidden: false,
        search: {
          title: 'Search Area',
          key: 'custom_search',
          icon: 'search',
          schema: {
            label: 'Search Area',
            customClass: 'col-12',
            key: 'search_area',
            properties: {
              type: 'search_area',
              query: '{}',
              model: '_model_',
              object: 'table',
              object_id: '_table_id_'
            },
            logic: [
              {
                name: 'all',
                trigger: {
                  type: 'json',
                  json: { '==': [1, 1] }
                },
                actions: [
                  {
                    name: 'eval query',
                    type: 'value',
                    value: `query={"cat":["{'parent':'", {"var":"form.rec_name"}, "'}"]}`
                  }
                ]
              }
            ],
            type: 'well',
            input: false,
            tableView: false,
            components: []
          }
        },
        export: {
          title: 'Export Area',
          key: 'export_area',
          icon: 'pdf',
          schema: {
            label: 'Export Area',
            customClass: 'col-12',
            key: 'export_area',
            properties: {
              type: 'export_area',
              search_id: 'search_area',
              model: '_model_',
              query: '{}',
              hide_all: 'si',
              csv_f: 'CSV',
              xls_f: 'XLS',
              json_f: 'JSON'
            },
            logic: [
              {
                name: 'check',
                trigger: {
                  type: 'json',
                  json: { var: 'form.rec_name' }
                },
                actions: [
                  {
                    name: 'make query',
                    type: 'value',
                    value: `query={"cat":["{'parent':'", {"var":"form.rec_name"}, "'}"]}`
                  }
                ]
              }
            ],
            type: 'well',
            input: false,
            tableView: false,
            components: []
          }
        },
        table: {
          title: 'Table',
          key: 'table',
          icon: 'table',
          schema: {
            label: 'Table',
            key: 'table',
            properties: {
              action_url: 'action url',
              model: 'model',
              show_owner: 'no',
              hide_select_chk: 'no',
              list_metadata_show: 'list_order,',
              dom: 'iptilp'
            },
            type: 'table',
            customClass: 'table table-borderless p-2',
            input: false,
            tableView: false,
            components: []
          }
        },
        datamap: false,
        editgrid: false,
        tree: false,
        container: false
      }
    },
    premium: {
      components: {
        form: false,
        resource: false,
        recaptcha: false,
        unknown: false
      }
    }
  });
}

function mergeRecords(...values: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of values) {
    for (const [key, entry] of Object.entries(value)) {
      const current = result[key];
      if (isPlainRecord(current) && isPlainRecord(entry)) {
        result[key] = mergeRecords(current, entry);
      } else {
        result[key] = deepClone(entry);
      }
    }
  }
  return result;
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry)) as T;
  if (isPlainRecord(value)) {
    const clone: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      clone[key] = deepClone(entry);
    });
    return clone as T;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainRecord(value) ? value : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
