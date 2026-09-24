import { z } from 'zod';
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256)
});
export const registerSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z
    .string()
    .min(8)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, '密码不能超过 72 字节')
});
export const createUserSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z
    .string()
    .min(8)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, '密码不能超过 72 字节'),
  role: z.enum(['ADMIN', 'USER']).default('USER')
});
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  serviceName: z.string().trim().min(1).max(120),
  expiresAt: z
    .string()
    .datetime()
    .refine((v) => Date.parse(v) > Date.now(), '过期时间必须在未来')
    .optional()
});
export const pushServiceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  authConfig: z.record(z.any()).optional(),
  timeoutMs: z.number().int().positive().max(60000).optional(),
  isEnabled: z.boolean().optional()
});
export const channelSchema = z.object({
  serviceId: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(120),
  configName: z.string().trim().min(1).max(120),
  configPayload: z.record(z.any()),
  tags: z.string().optional(),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional()
});
export const pushSchema = z
  .object({
    title: z.string().optional(),
    message: z.string().optional(),
    content: z.string().optional(),
    type: z.string().optional(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    customOptions: z.record(z.unknown()).optional(),
    extraOptions: z.record(z.unknown()).optional(),
    requestId: z.string().trim().min(1).max(128).optional()
  })
  .strict()
  .refine((v) => !!(v.message || v.content), { message: 'message 或 content 至少一个' });
