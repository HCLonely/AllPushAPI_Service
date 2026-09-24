import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { UserRole, UserStatus, Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { sanitizePath } from './security.js';
import { IS_PROD, JWT_SECRET } from './config.js';
import { ensureAdmin, getRetentionDays, cleanupLogs } from './maintenance.js';
import { registerAccountsRoutes } from './routes/accounts.js';
import { registerResourcesRoutes } from './routes/resources.js';
import { registerPushRoutes } from './routes/push.js';
import { registerLogsRoutes } from './routes/logs.js';

type AuthUser = { id: string; role: UserRole };

const resolveWebDistCandidates = () => {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist'),
    path.resolve(currentFileDir, '../../web/dist'),
    path.resolve(currentFileDir, '../../../apps/web/dist')
  ];
};

export const createServer = async () => {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]']
    },
    bodyLimit: 262144
  });
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const defaultDevCorsOrigins = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
  await app.register(cors, {
    origin: corsOrigins.length ? corsOrigins : IS_PROD ? false : defaultDevCorsOrigins,
    credentials: false
  });
  await app.register(fastifyRateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] }
  });

  app.setErrorHandler((error, request, reply) => {
    // Prisma/transport exception messages may embed credentials or query data.
    request.log.warn(
      { code: (error as { code?: string }).code, errorType: error instanceof Error ? error.name : 'Error' },
      'Request failed'
    );

    if (error instanceof z.ZodError) {
      return reply.code(400).send({ message: '请求参数错误', issues: error.issues });
    }

    if ((error as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
      if (request.url.startsWith('/api/v1/auth/register')) {
        return reply.code(409).send({ message: '用户名重复' });
      }
      return reply.code(409).send({ message: '数据唯一约束冲突' });
    }

    const httpError = error as { statusCode?: number; message?: string };
    if (httpError.statusCode && httpError.statusCode >= 400 && httpError.statusCode < 500) {
      return reply
        .code(httpError.statusCode)
        .send({ message: httpError.statusCode === 429 ? '请求过于频繁，请稍后重试' : httpError.message });
    }
    return reply.code(500).send({ message: '服务器内部错误' });
  });

  const verifyJwt = async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ message: '未授权' });
    }
    const dbUser = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (!dbUser || dbUser.status !== UserStatus.ACTIVE)
      return reply.code(401).send({ message: '账号不可用' });
    request.currentUser = dbUser;
  };
  const requireAdmin = async (request: any, reply: any) => {
    const user = request.currentUser as AuthUser;
    if (user.role !== UserRole.ADMIN) return reply.code(403).send({ message: '仅管理员可访问' });
  };

  app.addHook('onSend', async (_request, reply, payload) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer');
    if (_request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
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

  registerAccountsRoutes(app, verifyJwt, requireAdmin);
  registerResourcesRoutes(app, verifyJwt);
  registerPushRoutes(app);
  registerLogsRoutes(app, verifyJwt, requireAdmin);

  for (const candidate of resolveWebDistCandidates()) {
    try {
      await fs.access(candidate);
      await app.register(fastifyStatic, { root: candidate });
      app.setNotFoundHandler((request: any, reply: any) => {
        const url = String(request.raw?.url || '');
        const pathname = url.split('?')[0];
        if (
          ['GET', 'HEAD'].includes(request.method) &&
          pathname !== '/api' &&
          !pathname.startsWith('/api/') &&
          !path.extname(pathname) &&
          pathname !== '/health'
        ) {
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
  let cleaning = false;
  const timer = setInterval(async () => {
    if (cleaning) return;
    cleaning = true;
    try {
      await cleanupLogs();
    } catch (error) {
      app.log.error(error);
    } finally {
      cleaning = false;
    }
  }, 3600000);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
  return app;
};
