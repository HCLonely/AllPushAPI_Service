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

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 未配置，请设置随机密钥（生产环境至少 32 个字符）');
}
if (IS_PROD && JWT_SECRET.length < 32) {
  throw new Error(`JWT_SECRET 长度不足：当前 ${JWT_SECRET.length} 个字符，生产环境至少需要 32 个字符`);
}
if (IS_PROD && /^(change-me|dev-secret|your-secret)/i.test(JWT_SECRET)) {
  throw new Error('JWT_SECRET 使用了示例或默认值，请替换为随机生成的密钥');
}
