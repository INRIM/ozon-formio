import { FormBuilder, Formio } from '@formio/js';

const OZON_PROJECTLESS_BUILDER_PLUGIN = 'ozon-formio-projectless-builder';
export const OZON_FORMIO_VIRTUAL_PROJECT_ID = 'ozon-builder';

let projectlessBuilderPluginRegistered = false;

export function buildOzonVirtualProjectUrl(projectUrl: string, baseUrl = ''): string {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const normalizedProject = String(projectUrl || '').trim().replace(/\/+$/, '');
  const source = normalizedProject || normalizedBase || '/api';
  if (/(^|\/)project\/[^/]+$/i.test(source)) {
    return source.replace(/\/[^/]+$/i, `/${OZON_FORMIO_VIRTUAL_PROJECT_ID}`);
  }
  if (/(^|\/)project$/i.test(source)) {
    return `${source}/${OZON_FORMIO_VIRTUAL_PROJECT_ID}`;
  }
  return `${source}/project/${OZON_FORMIO_VIRTUAL_PROJECT_ID}`;
}

export function createOzonProjectlessBuilderPlugin(): { priority: number; request: (args: any) => unknown } {
  return {
    priority: 1100,
    request: (args: any) => {
      const path = normalizeUrlPath(String(args?.url ?? ''));
      if (/(^|\/)project\/ozon-builder$/.test(path)) {
        return {
          _id: OZON_FORMIO_VIRTUAL_PROJECT_ID,
          title: 'Ozon Builder',
          name: OZON_FORMIO_VIRTUAL_PROJECT_ID,
          path: OZON_FORMIO_VIRTUAL_PROJECT_ID,
          settings: {
            addConfigToForms: false
          },
          config: {}
        };
      }
      if (/(^|\/)project\/ozon-builder\/form$/.test(path)) {
        return [];
      }
      return null;
    }
  };
}

function ensureProjectlessBuilderPluginRegistered(): void {
  if (projectlessBuilderPluginRegistered) return;
  Formio.registerPlugin(createOzonProjectlessBuilderPlugin() as any, OZON_PROJECTLESS_BUILDER_PLUGIN);
  projectlessBuilderPluginRegistered = true;
}

function normalizeUrlPath(url: string): string {
  if (!url) return '';
  try {
    return new URL(url, 'http://localhost').pathname.replace(/\/+$/, '');
  } catch {
    return url.split('?')[0]?.replace(/\/+$/, '') ?? '';
  }
}

export class OzonFormBuilder extends FormBuilder {
  constructor(element: HTMLElement, form?: unknown, options?: Record<string, unknown>) {
    ensureProjectlessBuilderPluginRegistered();
    const sdk = Formio as typeof Formio & {
      baseUrl?: string;
      projectUrl?: string;
      projectUrlSet?: boolean;
    };
    const previousProjectUrl = String(sdk.projectUrl ?? '');
    const previousProjectUrlSet = Boolean(sdk.projectUrlSet);
    Formio.setProjectUrl(buildOzonVirtualProjectUrl(previousProjectUrl, String(sdk.baseUrl ?? '')));
    const mergedOptions: Record<string, unknown> = { ...(options ?? {}) };
    if (!String(mergedOptions['baseUrl'] ?? '').trim()) {
      mergedOptions['baseUrl'] = String(sdk.baseUrl ?? '');
    }
    if (mergedOptions['projectId'] == null) {
      mergedOptions['projectId'] = '';
    }
    try {
      super(element, form as any, mergedOptions as any);
    } finally {
      sdk.projectUrl = previousProjectUrl;
      sdk.projectUrlSet = previousProjectUrlSet;
    }
  }
}
