import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { ApiKeyStatus, DeliveryStatus, PushStatus, UserStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { sanitizePayload, sanitizeErrorText } from '../security.js';
import { deliver } from '../delivery.js';
import { pushSchema } from '../schemas.js';
import {
  PUSH_RATE_LIMIT_MAX,
  PUSH_RATE_LIMIT_WINDOW,
  PUSH_FAILED_DETAIL_LIMIT,
  PUSH_FAILED_MESSAGE_MAX_LEN
} from '../config.js';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function registerPushRoutes(app: FastifyInstance) {
  app.post(
    '/api/v1/push/send',
    {
      config: { rateLimit: { max: PUSH_RATE_LIMIT_MAX, timeWindow: PUSH_RATE_LIMIT_WINDOW } }
    },
    async (request: any, reply) => {
      const apiKeyValue = String(request.headers['x-api-key'] || '');
      if (!apiKeyValue) return reply.code(401).send({ message: '缺少 X-API-Key' });

      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash: hash(apiKeyValue) },
        include: { user: true }
      });
      if (!apiKey || apiKey.status !== ApiKeyStatus.ACTIVE)
        return reply.code(401).send({ message: 'API Key 无效' });
      if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now())
        return reply.code(401).send({ message: 'API Key 已过期' });
      if (apiKey.user.status !== UserStatus.ACTIVE) return reply.code(403).send({ message: '用户已禁用' });
      if (!apiKey.serviceName) return reply.code(401).send({ message: 'API Key 未绑定推送服务，请重新创建' });

      request.currentUser = apiKey.user;
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

      if (!configs.length)
        return reply.code(400).send({ message: `服务 ${apiKey.serviceName} 下没有匹配到可用推送配置` });

      const requestId = body.requestId || crypto.randomUUID();
      const reqLog = await prisma.pushRequest.create({
        data: {
          userId: apiKey.userId,
          apiKeyId: apiKey.id,
          requestId,
          sourceIp: request.ip,
          userAgent: request.headers['user-agent'],
          payload: sanitizePayload(body),
          resolvedTargets: configs.map((c) => ({
            id: c.id,
            serviceId: c.serviceId,
            platform: c.platform,
            configName: c.configName
          })),
          status: PushStatus.FAILED
        }
      });

      const deliveries = await deliver(configs, body, reqLog.id, apiKey.userId);

      const successCount = deliveries.filter((d) => d.status === DeliveryStatus.SUCCESS).length;
      const failedCount = deliveries.length - successCount;
      const total = deliveries.length;
      const status =
        total === 0
          ? PushStatus.FAILED
          : failedCount === 0
            ? PushStatus.SUCCESS
            : successCount === 0
              ? PushStatus.FAILED
              : PushStatus.PARTIAL_FAILED;

      const failedItems = deliveries.filter((d) => d.status === DeliveryStatus.FAILED);
      const trimMessage = (value: string) => {
        const sanitized = sanitizeErrorText(value);
        return sanitized.length > PUSH_FAILED_MESSAGE_MAX_LEN
          ? `${sanitized.slice(0, PUSH_FAILED_MESSAGE_MAX_LEN)}…`
          : sanitized;
      };

      const parseErrorDetail = (raw: unknown) => {
        if (typeof raw !== 'string' || !raw.trim())
          return { errorCode: undefined as string | undefined, errorMessage: '' };
        const text = raw.trim();
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const nested =
            parsed?.error && typeof parsed.error === 'object'
              ? (parsed.error as Record<string, unknown>)
              : undefined;
          const code = nested?.code ?? parsed.errorCode ?? parsed.code ?? parsed.errCode;
          const message = nested?.message ?? parsed.errorMessage ?? parsed.message ?? parsed.msg;
          return {
            errorCode: typeof code === 'string' || typeof code === 'number' ? String(code) : undefined,
            errorMessage: trimMessage(
              typeof message === 'string' || typeof message === 'number' ? String(message) : text
            )
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

      await prisma.$transaction([
        prisma.pushDelivery.createMany({ data: deliveries }),
        prisma.pushRequest.update({
          where: { id: reqLog.id },
          data: {
            status,
            errorMessage: total === 0 ? '未产生任何投递结果' : failedCount ? `失败 ${failedCount} 条` : null,
            finishedAt: new Date()
          }
        })
      ]);

      return {
        requestId,
        status,
        successCount,
        failedCount,
        total: deliveries.length,
        ...(failedCount > 0
          ? {
              errorSummary,
              failedDetails,
              detailLimit: PUSH_FAILED_DETAIL_LIMIT,
              detailAvailable,
              detailTruncated,
              detailReference: {
                requestId,
                endpoint: `/api/v1/logs/push-requests/${reqLog.id}`
              }
            }
          : {})
      };
    }
  );
}
