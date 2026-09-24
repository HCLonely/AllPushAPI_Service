import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { platformKey, isSupportedPlatform } from './platforms.js';
export type TemplateField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  defaultValue?: unknown;
  description?: string;
  inputType?: string;
  repeat?: boolean;
  children?: TemplateField[];
};

export type PlatformTemplate = {
  platform: string;
  schema: TemplateField[];
};

let templateCache: PlatformTemplate[] | null = null;
export const normalizePlatform = platformKey;
const normalizeTemplateField = (key: string, node: any): TemplateField => {
  const type = typeof node?.type === 'string' ? node.type : 'text';
  const childrenSource = node?.body;
  let children: TemplateField[] | undefined;

  if (
    type === 'object' &&
    childrenSource &&
    typeof childrenSource === 'object' &&
    !Array.isArray(childrenSource)
  ) {
    children = Object.entries(childrenSource).map(([childKey, childNode]) =>
      normalizeTemplateField(childKey, childNode)
    );
  }

  if (type === 'array' && Array.isArray(childrenSource)) {
    children = childrenSource.map((childNode, index) =>
      normalizeTemplateField(String(childNode?.name || `item${index + 1}`), childNode)
    );
  }

  return {
    key,
    label: typeof node?.name === 'string' ? node.name : key,
    type,
    required: Boolean(node?.required),
    defaultValue: node?.defaultValue,
    description: typeof node?.desp === 'string' ? node.desp : undefined,
    inputType: typeof node?.inputType === 'string' ? node.inputType : undefined,
    repeat: Boolean(node?.repeat),
    children
  };
};

const normalizeTemplateDoc = (doc: any): PlatformTemplate[] => {
  if (!Array.isArray(doc)) return [];
  return doc
    .map((entry) => {
      const platform = String(entry?.name || '').trim();
      const body =
        entry?.body && typeof entry.body === 'object' && !Array.isArray(entry.body) ? entry.body : {};
      const schema = Object.entries(body).map(([key, node]) => normalizeTemplateField(key, node));
      return { platform, schema };
    })
    .filter((entry) => entry.platform && entry.schema.length && isSupportedPlatform(entry.platform));
};

const resolveTemplateCandidates = () => {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(process.cwd(), 'node_modules/all-pusher-api/config/template.yaml.js'),
    path.resolve(process.cwd(), '../../node_modules/all-pusher-api/config/template.yaml.js'),
    path.resolve(currentFileDir, '../node_modules/all-pusher-api/config/template.yaml.js'),
    path.resolve(currentFileDir, '../../node_modules/all-pusher-api/config/template.yaml.js'),
    path.resolve(currentFileDir, '../../../node_modules/all-pusher-api/config/template.yaml.js')
  ];
};

export const loadPlatformTemplates = async () => {
  if (templateCache) return templateCache;

  for (const filename of resolveTemplateCandidates()) {
    try {
      const raw = await fs.readFile(filename, 'utf8');
      const doc = parseYaml(raw);
      const templates = normalizeTemplateDoc(doc);
      if (templates.length) {
        templateCache = templates;
        return templates;
      }
    } catch {
      continue;
    }
  }

  throw new Error('无法加载 all-pusher-api 模板文件');
};
