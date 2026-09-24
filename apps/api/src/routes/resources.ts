import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ApiKeyStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { loadPlatformTemplates, normalizePlatform } from '../templates.js';
import { createApiKeySchema, pushServiceSchema, channelSchema } from '../schemas.js';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function registerResourcesRoutes(app: FastifyInstance, verifyJwt: preHandlerHookHandler) {
  app.get('/api/v1/api-keys', { preHandler: [verifyJwt] }, async (request: any) => {
    const items = await prisma.apiKey.findMany({
      where: { userId: request.user.id, status: ApiKeyStatus.ACTIVE },
      orderBy: { createdAt: 'desc' }
    });
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
    const service = await prisma.pushService.findFirst({
      where: { userId: request.user.id, name: body.serviceName }
    });
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
    return prisma.apiKey.update({
      where: { id: row.id },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
      select: { id: true, status: true, revokedAt: true }
    });
  });

  app.get('/api/v1/push-services', { preHandler: [verifyJwt] }, async (request: any) => {
    return {
      items: await prisma.pushService.findMany({
        where: { userId: request.user.id },
        orderBy: { createdAt: 'desc' }
      })
    };
  });

  app.post('/api/v1/push-services', { preHandler: [verifyJwt] }, async (request: any) => {
    const body = pushServiceSchema.parse(request.body);
    return prisma.pushService.create({ data: { userId: request.user.id, ...body } });
  });

  app.patch('/api/v1/push-services/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = pushServiceSchema.partial().parse(request.body);
    const row = await prisma.pushService.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!row) return reply.code(404).send({ message: '服务不存在' });

    if (body.name && body.name !== row.name) {
      const [updatedService] = await prisma.$transaction([
        prisma.pushService.update({ where: { id: row.id }, data: body }),
        prisma.apiKey.updateMany({
          where: { userId: request.user.id, serviceName: row.name },
          data: { serviceName: body.name }
        })
      ]);
      return updatedService;
    }

    return prisma.pushService.update({ where: { id: row.id }, data: body });
  });

  app.delete('/api/v1/push-services/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const row = await prisma.pushService.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!row) return reply.code(404).send({ message: '服务不存在' });
    await prisma.$transaction([
      prisma.apiKey.updateMany({
        where: { userId: request.user.id, serviceName: row.name },
        data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() }
      }),
      prisma.pushService.delete({ where: { id: row.id } })
    ]);
    return { success: true };
  });

  app.get('/api/v1/channel-configs', { preHandler: [verifyJwt] }, async (request: any) => {
    const q = z
      .object({ serviceId: z.string().optional(), platform: z.string().optional() })
      .parse(request.query);
    const items = await prisma.channelConfig.findMany({
      where: { userId: request.user.id, serviceId: q.serviceId, platform: q.platform },
      include: { service: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }]
    });
    return { items };
  });

  app.post('/api/v1/channel-configs', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = channelSchema.parse(request.body);
    const service = await prisma.pushService.findFirst({
      where: { id: body.serviceId, userId: request.user.id }
    });
    if (!service) return reply.code(404).send({ message: '推送服务不存在' });
    return prisma.channelConfig.create({ data: { userId: request.user.id, ...body } });
  });

  app.patch('/api/v1/channel-configs/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const body = channelSchema.partial().parse(request.body);
    const row = await prisma.channelConfig.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
    if (!row) return reply.code(404).send({ message: '配置不存在' });

    if (body.serviceId) {
      const service = await prisma.pushService.findFirst({
        where: { id: body.serviceId, userId: request.user.id }
      });
      if (!service) return reply.code(404).send({ message: '推送服务不存在' });
    }

    return prisma.channelConfig.update({ where: { id: row.id }, data: body });
  });

  app.delete('/api/v1/channel-configs/:id', { preHandler: [verifyJwt] }, async (request: any, reply) => {
    const row = await prisma.channelConfig.findFirst({
      where: { id: request.params.id, userId: request.user.id }
    });
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

  app.get(
    '/api/v1/templates/platforms/:platform/schema',
    { preHandler: [verifyJwt] },
    async (request: any, reply) => {
      const templates = await loadPlatformTemplates();
      const target = String(request.params.platform || '');
      const targetKey = normalizePlatform(target);
      const found = templates.find(
        (item) => normalizePlatform(item.platform) === targetKey || item.platform === target
      );
      if (!found) return reply.code(404).send({ message: '平台模板不存在' });
      return { platform: found.platform, key: normalizePlatform(found.platform), schema: found.schema };
    }
  );
}
