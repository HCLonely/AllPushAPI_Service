import type { TemplateField } from './types';
export const toPayloadBySchema = (fields: TemplateField[], value: any): any => {
  const source = value && typeof value === 'object' ? value : {};
  const output: any = { ...source };
  for (const field of fields) {
    const current = source[field.key];
    if (current === undefined || current === null || current === '') {
      delete output[field.key];
      continue;
    }
    if (field.type === 'object') {
      output[field.key] = toPayloadBySchema(field.children || [], current);
      continue;
    }
    if (field.type === 'boolean') {
      output[field.key] = Boolean(current);
      continue;
    }
    if (field.type === 'array') {
      if (Array.isArray(current)) {
        output[field.key] = current;
      } else if (typeof current === 'string') {
        const raw = current.trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          output[field.key] = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          output[field.key] = raw
            .split(/[\n,]/)
            .map((x) => x.trim())
            .filter(Boolean);
        }
      }
      continue;
    }
    if (field.inputType === 'number') {
      const n = Number(current);
      output[field.key] = Number.isNaN(n) ? current : n;
      continue;
    }
    output[field.key] = current;
  }
  return output;
};

export const setDefaultBySchema = (fields: TemplateField[]) => {
  const output: any = {};
  for (const field of fields) {
    if (field.type === 'object' && field.children?.length) {
      output[field.key] = setDefaultBySchema(field.children);
      continue;
    }
    if (field.defaultValue !== undefined) {
      output[field.key] = field.defaultValue;
    }
  }
  return output;
};

export function toFormValues(fields: TemplateField[], value: Record<string, any>): Record<string, any> {
  const result = { ...value };
  for (const field of fields) {
    const current = result[field.key];
    if (field.type === 'array' && Array.isArray(current))
      result[field.key] = JSON.stringify(current, null, 2);
    if (field.type === 'object' && current && typeof current === 'object')
      result[field.key] = toFormValues(field.children || [], current);
  }
  return result;
}
