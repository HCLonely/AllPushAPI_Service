import type { Prisma } from '@prisma/client';
const SENSITIVE_FIELD_RE = /(pass(word|wd)?|secret|token|authorization|api[-_]?key|keyhash|cookie|^key$)/i;
export const sanitizePath = (url: string) => url.split('?')[0] || '/';
export const sanitizePayload = (value: unknown): Prisma.InputJsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item)) as Prisma.InputJsonArray;
  }
  if (value === null || typeof value !== 'object') {
    return (value ?? null) as Prisma.InputJsonValue;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, current] of Object.entries(input)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = sanitizePayload(current);
  }
  return output as Prisma.InputJsonObject;
};

export const sanitizeErrorText = (raw: string) => {
  const text = raw.trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(sanitizePayload(parsed));
  } catch {
    return text
      .replace(
        /((?:password|passwd|secret|token|authorization|api[-_]?key|keyhash)\s*[:=]\s*)([^,\s]+)/gi,
        '$1[REDACTED]'
      )
      .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]');
  }
};
