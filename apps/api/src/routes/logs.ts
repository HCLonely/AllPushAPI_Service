import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { getRetentionDays, cleanupLogs } from '../maintenance.js';

export function registerLogsRoutes(
  app: FastifyInstance,
  verifyJwt: preHandlerHookHandler,
  requireAdmin: preHandlerHookHandler
) {
  app.get('/api/v1/logs/push-requests', { preHandler: [verifyJwt] }, async (request: any) => {
    const { page, pageSize } = z
      .object({
        page: z.coerce.number().int().min(1).max(1000000).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(200)
      })
      .parse(request.query);
    const where = { userId: request.user.id };
    const [items, total] = await prisma.$transaction([
      prisma.pushRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.pushRequest.count({ where })
    ]);
    return { items, total, page, pageSize };
  });

  app.get('/api/v1/logs/push-requests/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const item = await prisma.pushRequest.findFirst({
      where: { id: request.params.id, userId: request.user.id },
      include: { deliveries: true }
    });
    if (!item) return reply.code(404).send({ message: '日志不存在' });
    return item;
  });

  app.get('/api/v1/logs/access', { preHandler: [verifyJwt] }, async (request: any) => {
    return {
      items: await prisma.accessLog.findMany({
        where: { userId: request.user.id },
        orderBy: { createdAt: 'desc' },
        take: 200
      })
    };
  });

  app.get('/api/v1/admin/settings', { preHandler: [verifyJwt, requireAdmin] }, async () => ({
    logRetentionDays: await getRetentionDays()
  }));
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
    const query = z
      .object({
        page: z.coerce.number().int().min(1).max(1000000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20)
      })
      .parse(request.query || {});

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
    items: await prisma.pushRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { user: { select: { username: true } } }
    })
  }));

  app.post('/api/v1/admin/logs/cleanup', { preHandler: [verifyJwt, requireAdmin] }, async () => {
    await cleanupLogs();
    return { success: true };
  });
}
