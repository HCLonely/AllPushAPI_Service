import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcryptjs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { PushApi } from 'all-pusher-api';
import { ApiKeyStatus, DeliveryStatus, PushStatus, UserRole, UserStatus, Prisma } from '@prisma/client';
import { prisma } from './db.js';

const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? '' : 'dev-secret-change-me');
const LOG_RETENTION_DEFAULT_DAYS = Number(process.env.LOG_RETENTION_DEFAULT_DAYS || 30);
const toBoundedInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return Math.min(max, Math.max(min, intValue));
};

const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 10);
const AUTH_RATE_LIMIT_WINDOW = process.env.AUTH_RATE_LIMIT_WINDOW || '1 minute';
const PUSH_RATE_LIMIT_MAX = Number(process.env.PUSH_RATE_LIMIT_MAX || 60);
const PUSH_RATE_LIMIT_WINDOW = process.env.PUSH_RATE_LIMIT_WINDOW || '1 minute';
const PUSH_FAILED_DETAIL_LIMIT = toBoundedInt(process.env.PUSH_FAILED_DETAIL_LIMIT, 20, 1, 100);
const PUSH_FAILED_MESSAGE_MAX_LEN = toBoundedInt(process.env.PUSH_FAILED_MESSAGE_MAX_LEN, 300, 80, 1000);
const SENSITIVE_FIELD_RE = /(password|passwd|secret|token|authorization|api[-_]?key|keyhash)/i;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET 未配置，生产环境禁止使用默认值');
}

type AuthUser = { id: string; role: UserRole };

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const registerSchema = z.object({ username: z.string().min(3), password: z.string().min(6) });
const createUserSchema = z.object({ username: z.string().min(3), password: z.string().min(6), role: z.enum(['ADMIN', 'USER']).default('USER') });
const createApiKeySchema = z.object({
  name: z.string().min(1),
  serviceName: z.string().min(1),
  expiresAt: z.string().datetime().optional()
});
const pushServiceSchema = z.object({
  name: z.string().min(1),
  authConfig: z.record(z.any()).optional(),
  timeoutMs: z.number().int().positive().max(60000).optional(),
  isEnabled: z.boolean().optional()
});
const channelSchema = z.object({
  serviceId: z.string().min(1),
  platform: z.string().min(1),
  configName: z.string().min(1),
  configPayload: z.record(z.any()),
  tags: z.string().optional(),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional()
});
const pushSchema = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  content: z.string().optional(),
  type: z.string().optional(),
  to: z.union([z.string(), z.array(z.string())]).optional(),
  customOptions: z.any().optional(),
  extraOptions: z.any().optional(),
  requestId: z.string().optional()
}).strict().refine((v) => !!(v.message || v.content), { message: 'message 或 content 至少一个' });

const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

type TemplateField = {
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

type PlatformTemplate = {
  platform: string;
  schema: TemplateField[];
};

let templateCache: PlatformTemplate[] | null = null;

const normalizePlatform = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
const sanitizePath = (url: string) => url.split('?')[0] || '/';
const sanitizePayload = (value: unknown): Prisma.InputJsonValue => {
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

const sanitizeErrorText = (raw: string) => {
  const text = raw.trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(sanitizePayload(parsed));
  } catch {
    return text
      .replace(/((?:password|passwd|secret|token|authorization|api[-_]?key|keyhash)\s*[:=]\s*)([^,\s]+)/ig, '$1[REDACTED]')
      .replace(/(bearer\s+)[^\s]+/ig, '$1[REDACTED]');
  }
};

const normalizeTemplateField = (key: string, node: any): TemplateField => {
  const type = typeof node?.type === 'string' ? node.type : 'text';
  const childrenSource = node?.body;
  let children: TemplateField[] | undefined;

  if (type === 'object' && childrenSource && typeof childrenSource === 'object' && !Array.isArray(childrenSource)) {
    children = Object.entries(childrenSource).map(([childKey, childNode]) => normalizeTemplateField(childKey, childNode));
  }

  if (type === 'array' && Array.isArray(childrenSource)) {
    children = childrenSource.map((childNode, index) => normalizeTemplateField(String(childNode?.name || `item${index + 1}`), childNode));
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
      const body = entry?.body && typeof entry.body === 'object' && !Array.isArray(entry.body) ? entry.body : {};
      const schema = Object.entries(body).map(([key, node]) => normalizeTemplateField(key, node));
      return { platform, schema };
    })
    .filter((entry) => entry.platform && entry.schema.length);
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

const resolveWebDistCandidates = () => {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist'),
    path.resolve(currentFileDir, '../../web/dist'),
    path.resolve(currentFileDir, '../../../apps/web/dist')
  ];
};

const loadPlatformTemplates = async () => {
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

async function getRetentionDays() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'log_retention_days' } });
  if (row) return Number(row.value) || LOG_RETENTION_DEFAULT_DAYS;
  await prisma.systemSetting.create({ data: { key: 'log_retention_days', value: String(LOG_RETENTION_DEFAULT_DAYS) } });
  return LOG_RETENTION_DEFAULT_DAYS;
}

async function cleanupLogs() {
  const days = await getRetentionDays();
  const cutoff = new Date(Date.now() - days * 86400000);
  await prisma.accessLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  await prisma.pushRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

async function ensureAdmin() {
  const count = await prisma.user.count({ where: { role: UserRole.ADMIN } });
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME || (IS_PROD ? '' : 'admin');
  const password = process.env.ADMIN_PASSWORD || (IS_PROD ? '' : 'admin123');
  if (!username || !password) {
    throw new Error('ADMIN_USERNAME/ADMIN_PASSWORD 未配置，生产环境禁止自动默认管理员');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE
    }
  });
}

export const createServer = async () => {
  const app = Fastify({ logger: true });
  const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean);
  const defaultDevCorsOrigins = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
  await app.register(cors, {
    origin: corsOrigins.length ? corsOrigins : (IS_PROD ? false : defaultDevCorsOrigins),
    credentials: false
  });
  await app.register(fastifyRateLimit, { global: false, skipOnError: true });
  await app.register(jwt, { secret: JWT_SECRET });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ message: '请求参数错误', issues: error.issues });
    }

    if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
      if (request.url.startsWith('/api/v1/auth/register')) {
        return reply.code(409).send({ message: '用户名重复' });
      }
      return reply.code(409).send({ message: '数据唯一约束冲突' });
    }

    return reply.code(500).send({ message: '服务器内部错误' });
  });

  const verifyJwt = async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
      const dbUser = await prisma.user.findUnique({ where: { id: request.user.id } });
      if (!dbUser || dbUser.status !== UserStatus.ACTIVE) {
        return reply.code(401).send({ message: '账号不可用' });
      }
      request.currentUser = dbUser;
    } catch {
      return reply.code(401).send({ message: '未授权' });
    }
  };
  const requireAdmin = async (request: any, reply: any) => {
    const user = request.currentUser as AuthUser;
    if (user.role !== UserRole.ADMIN) return reply.code(403).send({ message: '仅管理员可访问' });
  };

  app.addHook('onResponse', async (request, reply) => {
    try {
      await prisma.accessLog.create({
        data: {
          userId: (request as any).currentUser?.id,
          path: sanitizePath(request.url),
          method: request.method,
          statusCode: reply.statusCode,
          sourceIp: request.ip,
          userAgent: request.headers['user-agent']
        }
      });
    } catch {}
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW } }
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user || user.status !== UserStatus.ACTIVE) return reply.code(401).send({ message: '用户名或密码错误' });
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ message: '用户名或密码错误' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const accessToken = await reply.jwtSign({ id: user.id, username: user.username, role: user.role }, { expiresIn: '7d' });
    return { accessToken, user: { id: user.id, username: user.username, role: user.role } };
  });

  app.post('/api/v1/auth/register', {
    config: { rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW } }
  }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        username: body.username,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE
      }
    });
    return reply.code(201).send({ id: user.id, username: user.username, role: user.role, status: user.status });
  });

  app.get('/api/v1/auth/me', { preHandler: [verifyJwt] }, async (request: any) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (!user) return { user: null };
    return { user: { id: user.id, username: user.username, role: user.role, status: user.status } };
  });
  app.get('/api/v1/admin/users', { preHandler: [verifyJwt, requireAdmin] }, async () => {
    const items = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return { items: items.map((u) => ({ id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt })) };
  });

  app.post('/api/v1/admin/users', { preHandler: [verifyJwt, requireAdmin] }, async (request) => {
    const body = createUserSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({ data: { username: body.username, passwordHash, role: body.role as UserRole, status: UserStatus.ACTIVE } });
    return { id: user.id, username: user.username, role: user.role, status: user.status };
  });

  app.patch('/api/v1/admin/users/:id/status', { preHandler: [verifyJwt, requireAdmin] }, async (request: any, reply) => {
    const status = z.enum(['ACTIVE', 'DISABLED']).parse((request.body as any)?.status);
    const user = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!user) return reply.code(404).send({ message: '用户不存在' });
    return prisma.user.update({ where: { id: user.id }, data: { status } });
  });

  app.get('/api/v1/api-keys', { preHandler: [verifyJwt] }, async (request: any) => {
    const items = await prisma.apiKey.findMany({ where: { userId: request.user.id, status: ApiKeyStatus.ACTIVE }, orderBy: { createdAt: 'desc' } });
    return {
      items: items.map((k) => ({
        id: k.id,
        name: k.name,
        serviceName: k.serviceName,
        keyPrefix: k.keyPrefix,
        status: k.status,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt
      }))
    };
  });

  app.post('/api/v1/api-keys', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = createApiKeySchema.parse(request.body);
    const service = await prisma.pushService.findFirst({ where: { userId: request.user.id, name: body.serviceName } });
    if (!service) return reply.code(404).send({ message: '绑定的推送服务不存在' });

    const apiKey = `apu_${crypto.randomBytes(24).toString('hex')}`;
    const record = await prisma.apiKey.create({
      data: {
        userId: request.user.id,
        serviceName: body.serviceName,
        name: body.name,
        keyPrefix: apiKey.slice(0, 12),
        keyHash: hash(apiKey),
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined
      }
    });
    return {
      id: record.id,
      name: record.name,
      serviceName: record.serviceName,
      apiKey,
      keyPrefix: record.keyPrefix,
      expiresAt: record.expiresAt
    };
  });

  app.patch('/api/v1/api-keys/:id/revoke', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const row = await prisma.apiKey.findFirst({ where: { id: request.params.id, userId: request.user.id } });
    if (!row) return reply.code(404).send({ message: 'API Key 不存在' });
    return prisma.apiKey.update({ where: { id: row.id }, data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() } });
  });

  app.get('/api/v1/push-services', { preHandler: [verifyJwt] }, async (request: any) => {
    return { items: await prisma.pushService.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' } }) };
  });

  app.post('/api/v1/push-services', { preHandler: [verifyJwt] }, async (request: any) => {
    const body = pushServiceSchema.parse(request.body);
    return prisma.pushService.create({ data: { userId: request.user.id, ...body } });
  });

  app.patch('/api/v1/push-services/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = pushServiceSchema.partial().parse(request.body);
    const row = await prisma.pushService.findFirst({ where: { id: request.params.id, userId: request.user.id } });
    if (!row) return reply.code(404).send({ message: '服务不存在' });

    if (body.name && body.name !== row.name) {
      const [updatedService] = await prisma.$transaction([
        prisma.pushService.update({ where: { id: row.id }, data: body }),
        prisma.apiKey.updateMany({ where: { userId: request.user.id, serviceName: row.name }, data: { serviceName: body.name } })
      ]);
      return updatedService;
    }

    return prisma.pushService.update({ where: { id: row.id }, data: body });
  });

  app.delete('/api/v1/push-services/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const row = await prisma.pushService.findFirst({ where: { id: request.params.id, userId: request.user.id } });
    if (!row) return reply.code(404).send({ message: '服务不存在' });
    await prisma.pushService.delete({ where: { id: row.id } });
    return { success: true };
  });

  app.get('/api/v1/channel-configs', { preHandler: [verifyJwt] }, async (request: any) => {
    const q = request.query as { serviceId?: string; platform?: string };
    const items = await prisma.channelConfig.findMany({
      where: { userId: request.user.id, serviceId: q.serviceId, platform: q.platform },
      include: { service: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }]
    });
    return { items };
  });

  app.post('/api/v1/channel-configs', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = channelSchema.parse(request.body);
    const service = await prisma.pushService.findFirst({ where: { id: body.serviceId, userId: request.user.id } });
    if (!service) return reply.code(404).send({ message: '推送服务不存在' });
    return prisma.channelConfig.create({ data: { userId: request.user.id, ...body } });
  });

  app.patch('/api/v1/channel-configs/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = channelSchema.partial().parse(request.body);
    const row = await prisma.channelConfig.findFirst({ where: { id: request.params.id, userId: request.user.id } });
    if (!row) return reply.code(404).send({ message: '配置不存在' });

    if (body.serviceId) {
      const service = await prisma.pushService.findFirst({ where: { id: body.serviceId, userId: request.user.id } });
      if (!service) return reply.code(404).send({ message: '推送服务不存在' });
    }

    return prisma.channelConfig.update({ where: { id: row.id }, data: body });
  });

  app.delete('/api/v1/channel-configs/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const row = await prisma.channelConfig.findFirst({ where: { id: request.params.id, userId: request.user.id } });
    if (!row) return reply.code(404).send({ message: '配置不存在' });
    await prisma.channelConfig.delete({ where: { id: row.id } });
    return { success: true };
  });

  app.get('/api/v1/templates/platforms', { preHandler: [verifyJwt] }, async () => {
    const templates = await loadPlatformTemplates();
    return {
      items: templates.map((item) => ({
        platform: item.platform,
        key: normalizePlatform(item.platform),
        fieldCount: item.schema.length
      }))
    };
  });

  app.get('/api/v1/templates/platforms/:platform/schema', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const templates = await loadPlatformTemplates();
    const target = String(request.params.platform || '');
    const targetKey = normalizePlatform(target);
    const found = templates.find((item) => normalizePlatform(item.platform) === targetKey || item.platform === target);
    if (!found) return reply.code(404).send({ message: '平台模板不存在' });
    return { platform: found.platform, key: normalizePlatform(found.platform), schema: found.schema };
  });

  app.post('/api/v1/push/send', {
    config: { rateLimit: { max: PUSH_RATE_LIMIT_MAX, timeWindow: PUSH_RATE_LIMIT_WINDOW } }
  }, async (request: any, reply) => {
    const apiKeyValue = String(request.headers['x-api-key'] || '');
    if (!apiKeyValue) return reply.code(401).send({ message: '缺少 X-API-Key' });

    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash: hash(apiKeyValue) }, include: { user: true } });
    if (!apiKey || apiKey.status !== ApiKeyStatus.ACTIVE) return reply.code(401).send({ message: 'API Key 无效' });
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) return reply.code(401).send({ message: 'API Key 已过期' });
    if (apiKey.user.status !== UserStatus.ACTIVE) return reply.code(403).send({ message: '用户已禁用' });
    if (!apiKey.serviceName) return reply.code(401).send({ message: 'API Key 未绑定推送服务，请重新创建' });

    const body = pushSchema.parse(request.body);
    await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    const configs = await prisma.channelConfig.findMany({
      where: {
        userId: apiKey.userId,
        isEnabled: true,
        service: { isEnabled: true, name: apiKey.serviceName }
      },
      include: { service: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
    });

    if (!configs.length) return reply.code(400).send({ message: `服务 ${apiKey.serviceName} 下没有匹配到可用推送配置` });

    const requestId = body.requestId || crypto.randomUUID();
    const reqLog = await prisma.pushRequest.create({
      data: {
        userId: apiKey.userId,
        apiKeyId: apiKey.id,
        requestId,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
        payload: sanitizePayload(body),
        resolvedTargets: configs.map((c) => ({ id: c.id, serviceId: c.serviceId, platform: c.platform, configName: c.configName })),
        status: PushStatus.FAILED
      }
    });

    const grouped = new Map<string, typeof configs>();
    for (const c of configs) grouped.set(c.serviceId, [...(grouped.get(c.serviceId) || []), c]);
    const deliveries: any[] = [];
    const stringifyResult = (result: unknown) => {
      const seen = new WeakSet<object>();
      try {
        const serialized = JSON.stringify(result, (_key, value) => {
          if (typeof value === 'bigint') return value.toString();
          if (!value || typeof value !== 'object') return value;
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
          return value;
        });
        return typeof serialized === 'string' ? serialized : 'null';
      } catch (error: any) {
        return JSON.stringify({ message: String(error?.message || '响应序列化失败') });
      }
    };

    for (const [serviceId, serviceConfigs] of grouped.entries()) {
      try {
        const pushApi = new PushApi(serviceConfigs.map((c) => ({ name: c.platform, config: c.configPayload as any })) as any);
        const startedAt = Date.now();
        const result = await pushApi.send({
          title: body.title,
          message: body.message || body.content || '',
          type: body.type,
          to: body.to as any,
          customOptions: body.customOptions,
          extraOptions: body.extraOptions
        } as any);
        const latencyMs = Date.now() - startedAt;

        const resultItems = Array.isArray(result) ? result : [];
        if (resultItems.length === serviceConfigs.length) {
          for (let i = 0; i < resultItems.length; i++) {
            const cfg = serviceConfigs[i];
            const item = resultItems[i];
            deliveries.push({
              pushRequestId: reqLog.id,
              userId: apiKey.userId,
              serviceId,
              channelConfigId: cfg.id,
              platform: cfg.platform,
              configName: cfg.configName,
              status: item?.result?.status === 200 ? DeliveryStatus.SUCCESS : DeliveryStatus.FAILED,
              responseCode: item?.result?.status,
              responseBody: stringifyResult(item?.result),
              latencyMs
            });
          }
        } else {
          const byPlatform = new Map<string, typeof serviceConfigs>();
          for (const c of serviceConfigs) byPlatform.set(c.platform, [...(byPlatform.get(c.platform) || []), c]);
          for (const item of resultItems) {
            for (const cfg of byPlatform.get(item?.name) || []) {
              deliveries.push({
                pushRequestId: reqLog.id,
                userId: apiKey.userId,
                serviceId,
                channelConfigId: cfg.id,
                platform: cfg.platform,
                configName: cfg.configName,
                status: item?.result?.status === 200 ? DeliveryStatus.SUCCESS : DeliveryStatus.FAILED,
                responseCode: item?.result?.status,
                responseBody: stringifyResult(item?.result),
                latencyMs
              });
            }
          }
        }
      } catch (error: any) {
        for (const cfg of serviceConfigs) {
          deliveries.push({
            pushRequestId: reqLog.id,
            userId: apiKey.userId,
            serviceId,
            channelConfigId: cfg.id,
            platform: cfg.platform,
            configName: cfg.configName,
            status: DeliveryStatus.FAILED,
            responseBody: String(error?.message || error)
          });
        }
      }
    }

    if (deliveries.length) await prisma.pushDelivery.createMany({ data: deliveries });

    const successCount = deliveries.filter((d) => d.status === DeliveryStatus.SUCCESS).length;
    const failedCount = deliveries.length - successCount;
    const total = deliveries.length;
    const status = total === 0
      ? PushStatus.FAILED
      : failedCount === 0
        ? PushStatus.SUCCESS
        : successCount === 0
          ? PushStatus.FAILED
          : PushStatus.PARTIAL_FAILED;

    const failedItems = deliveries.filter((d) => d.status === DeliveryStatus.FAILED);
    const trimMessage = (value: string) => {
      const sanitized = sanitizeErrorText(value);
      return sanitized.length > PUSH_FAILED_MESSAGE_MAX_LEN ? `${sanitized.slice(0, PUSH_FAILED_MESSAGE_MAX_LEN)}…` : sanitized;
    };

    const parseErrorDetail = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw.trim()) return { errorCode: undefined as string | undefined, errorMessage: '' };
      const text = raw.trim();
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const nested = parsed?.error && typeof parsed.error === 'object' ? parsed.error as Record<string, unknown> : undefined;
        const code = nested?.code ?? parsed.errorCode ?? parsed.code ?? parsed.errCode;
        const message = nested?.message ?? parsed.errorMessage ?? parsed.message ?? parsed.msg;
        return {
          errorCode: typeof code === 'string' || typeof code === 'number' ? String(code) : undefined,
          errorMessage: trimMessage(typeof message === 'string' || typeof message === 'number' ? String(message) : text)
        };
      } catch {
        return { errorCode: undefined as string | undefined, errorMessage: trimMessage(text) };
      }
    };

    const failedDetailsAll = failedItems.map((d) => {
      const parsed = parseErrorDetail(d.responseBody);
      return {
        serviceId: d.serviceId,
        channelConfigId: d.channelConfigId,
        platform: d.platform,
        configName: d.configName,
        responseCode: d.responseCode ?? null,
        errorCode: parsed.errorCode ?? null,
        errorMessage: parsed.errorMessage || '推送失败',
        retryable: d.responseCode ? d.responseCode >= 500 : true
      };
    });

    const errorSummary = failedDetailsAll.reduce<Record<string, number>>((acc, item) => {
      const key = item.errorCode || (item.responseCode ? `HTTP_${item.responseCode}` : 'UNKNOWN');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const failedDetails = failedDetailsAll.slice(0, PUSH_FAILED_DETAIL_LIMIT);
    const detailAvailable = failedDetailsAll.length;
    const detailTruncated = detailAvailable > failedDetails.length;

    await prisma.pushRequest.update({
      where: { id: reqLog.id },
      data: { status, errorMessage: total === 0 ? '未产生任何投递结果' : (failedCount ? `失败 ${failedCount} 条` : null), finishedAt: new Date() }
    });

    return {
      requestId,
      status,
      successCount,
      failedCount,
      total: deliveries.length,
      ...(failedCount > 0 ? {
        errorSummary,
        failedDetails,
        detailLimit: PUSH_FAILED_DETAIL_LIMIT,
        detailAvailable,
        detailTruncated,
        detailReference: {
          requestId,
          endpoint: `/api/v1/logs/push-requests/${reqLog.id}`
        }
      } : {})
    };
  });

  app.get('/api/v1/logs/push-requests', { preHandler: [verifyJwt] }, async (request: any) => {
    return { items: await prisma.pushRequest.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' }, take: 200 }) };
  });

  app.get('/api/v1/logs/push-requests/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const item = await prisma.pushRequest.findFirst({ where: { id: request.params.id, userId: request.user.id }, include: { deliveries: true } });
    if (!item) return reply.code(404).send({ message: '日志不存在' });
    return item;
  });

  app.get('/api/v1/logs/access', { preHandler: [verifyJwt] }, async (request: any) => {
    return { items: await prisma.accessLog.findMany({ where: { userId: request.user.id }, orderBy: { createdAt: 'desc' }, take: 200 }) };
  });

  app.get('/api/v1/admin/settings', { preHandler: [verifyJwt, requireAdmin] }, async () => ({ logRetentionDays: await getRetentionDays() }));
  app.patch('/api/v1/admin/settings', { preHandler: [verifyJwt, requireAdmin] }, async (request: any) => {
    const body = z.object({ logRetentionDays: z.number().int().min(1).max(3650) }).parse(request.body);
    await prisma.systemSetting.upsert({
      where: { key: 'log_retention_days' },
      update: { value: String(body.logRetentionDays), updatedBy: request.user.id },
      create: { key: 'log_retention_days', value: String(body.logRetentionDays), updatedBy: request.user.id }
    });
    return { logRetentionDays: body.logRetentionDays };
  });

  app.get('/api/v1/admin/logs/access', { preHandler: [verifyJwt, requireAdmin] }, async (request: any) => {
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20)
    }).parse(request.query || {});

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await Promise.all([
      prisma.accessLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: { user: { select: { username: true } } }
      }),
      prisma.accessLog.count()
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get('/api/v1/admin/logs/push-requests', { preHandler: [verifyJwt, requireAdmin] }, async () => ({
    items: await prisma.pushRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { user: { select: { username: true } } } })
  }));

  app.post('/api/v1/admin/logs/cleanup', { preHandler: [verifyJwt, requireAdmin] }, async () => {
    await cleanupLogs();
    return { success: true };
  });

  for (const candidate of resolveWebDistCandidates()) {
    try {
      await fs.access(candidate);
      await app.register(fastifyStatic, { root: candidate });
      app.setNotFoundHandler((request: any, reply: any) => {
        const url = String(request.raw?.url || '');
        if (!url.startsWith('/api/') && url !== '/health') {
          return reply.type('text/html').sendFile('index.html');
        }
        return reply.code(404).send({ message: 'Route not found' });
      });
      break;
    } catch {
      continue;
    }
  }

  await ensureAdmin();
  await getRetentionDays();
  await cleanupLogs();
  return app;
};
