import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { DeliveryStatus, PushStatus } from '@prisma/client';
import { z } from 'zod';
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { deliver, sendIsolated } from '../delivery.js';
import { channelInclude, serializeChannel } from '../channel-bindings.js';
import { sanitizePayload } from '../security.js';
import { PUSH_RATE_LIMIT_MAX, PUSH_RATE_LIMIT_WINDOW } from '../config.js';

const testSchema = z.object({
  serviceId: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(200).default('平台配置发送测试'),
  message: z.string().trim().min(1).max(10000).default('这是一条来自 All Push API 的测试消息。')
}).strict();

export function registerChannelTestRoutes(
  app: FastifyInstance,
  verifyJwt: preHandlerHookHandler,
  send = sendIsolated
) {
  app.post('/api/v1/channel-configs/:id/test', {
    preHandler: [verifyJwt],
    config: { rateLimit: { max: PUSH_RATE_LIMIT_MAX, timeWindow: PUSH_RATE_LIMIT_WINDOW } }
  }, async (request: any, reply) => {
    const body = testSchema.parse(request.body ?? {});
    const config = await prisma.channelConfig.findFirst({
      where: { id: request.params.id, userId: request.user.id },
      include: channelInclude
    });
    if (!config) return reply.code(404).send({ message: '配置不存在' });
    if (!config.isEnabled) return reply.code(400).send({ message: '请先启用平台配置再发送测试' });

    const services = serializeChannel(config).services;
    const service = body.serviceId
      ? services.find((item) => item.id === body.serviceId)
      : services.find((item) => item.isEnabled && item.userId === request.user.id);
    if (!service || service.userId !== request.user.id) {
      return reply.code(400).send({ message: '请选择此配置绑定的可用服务' });
    }
    if (!service.isEnabled) return reply.code(400).send({ message: '请先启用所选推送服务' });

    // 测试只发送当前已保存配置；不需要 API Key，也不扩散到服务下的其他配置。
    const requestId = `test-${crypto.randomUUID()}`;
    const payload = { title: body.title, message: body.message };
    const log = await prisma.pushRequest.create({
      data: {
        userId: request.user.id,
        requestId,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'],
        payload: sanitizePayload({ ...payload, source: 'channel-test' }),
        resolvedTargets: [{ id: config.id, serviceId: service.id, platform: config.platform, configName: config.configName }],
        status: PushStatus.FAILED
      }
    });
    const [delivery] = await deliver(
      [{ ...config, serviceId: service.id, service }], payload, log.id, request.user.id, send
    );
    const status = delivery.status === DeliveryStatus.SUCCESS ? PushStatus.SUCCESS : PushStatus.FAILED;
    const message = JSON.parse(delivery.responseBody as string).message as string;
    await prisma.$transaction([
      prisma.pushDelivery.create({ data: delivery }),
      prisma.pushRequest.update({
        where: { id: log.id },
        data: { status, errorMessage: status === PushStatus.FAILED ? message : null, finishedAt: new Date() }
      })
    ]);
    return {
      requestId, status, message,
      responseCode: delivery.responseCode ?? null,
      latencyMs: delivery.latencyMs,
      serviceId: service.id,
      channelConfigId: config.id,
      logId: log.id
    };
  });
}
