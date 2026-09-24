import crypto from 'node:crypto';
export const IS_PROD = process.env.NODE_ENV === 'production';
export const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? '' : crypto.randomBytes(32).toString('hex'));
export const toBoundedInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return Math.min(max, Math.max(min, intValue));
};

export const LOG_RETENTION_DEFAULT_DAYS = toBoundedInt(process.env.LOG_RETENTION_DEFAULT_DAYS, 30, 1, 3650);
export const AUTH_RATE_LIMIT_MAX = toBoundedInt(process.env.AUTH_RATE_LIMIT_MAX, 10, 1, 10000);
export const AUTH_RATE_LIMIT_WINDOW = process.env.AUTH_RATE_LIMIT_WINDOW || '1 minute';
export const PUSH_RATE_LIMIT_MAX = toBoundedInt(process.env.PUSH_RATE_LIMIT_MAX, 60, 1, 10000);
export const PUSH_RATE_LIMIT_WINDOW = process.env.PUSH_RATE_LIMIT_WINDOW || '1 minute';
export const PUSH_FAILED_DETAIL_LIMIT = toBoundedInt(process.env.PUSH_FAILED_DETAIL_LIMIT, 20, 1, 100);
export const PUSH_FAILED_MESSAGE_MAX_LEN = toBoundedInt(
  process.env.PUSH_FAILED_MESSAGE_MAX_LEN,
  300,
  80,
  1000
);

if (
  !JWT_SECRET ||
  (IS_PROD && (JWT_SECRET.length < 32 || /^(change-me|dev-secret|your-secret)/i.test(JWT_SECRET)))
) {
  throw new Error('JWT_SECRET 未配置，生产环境禁止使用默认值');
}
