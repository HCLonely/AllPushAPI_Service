import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

export const channelInclude = {
  service: true,
  bindings: { include: { service: true }, orderBy: { serviceId: 'asc' } }
} satisfies Prisma.ChannelConfigInclude;

type BoundChannel = Prisma.ChannelConfigGetPayload<{ include: typeof channelInclude }>;

export function serializeChannel(row: BoundChannel) {
  const { bindings, ...config } = row;
  const services = [row.service, ...bindings.map((binding) => binding.service)]
    .filter((service, index, items) => items.findIndex((item) => item.id === service.id) === index);
  return { ...config, serviceIds: services.map((service) => service.id), services };
}

export async function ensureChannelServiceBindings() {
  // Keep existing rows and their legacy primary service intact. The composite
  // key makes this safe to repeat, including after an interrupted upgrade.
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO "ChannelConfigService" ("channelConfigId", "serviceId")
    SELECT "id", "serviceId" FROM "ChannelConfig"
  `;
}

export async function validateChannelServices(
  tx: Prisma.TransactionClient,
  userId: string,
  serviceIds: string[],
  platform: string,
  configName: string,
  excludeId?: string
) {
  const count = await tx.pushService.count({ where: { id: { in: serviceIds }, userId } });
  if (count !== serviceIds.length)
    throw Object.assign(new Error('推送服务不存在'), { statusCode: 404 });

  const conflict = await tx.channelConfig.findFirst({
    where: {
      userId, platform, configName,
      id: excludeId ? { not: excludeId } : undefined,
      OR: [
        { serviceId: { in: serviceIds } },
        { bindings: { some: { serviceId: { in: serviceIds } } } }
      ]
    },
    select: { id: true }
  });
  if (conflict)
    throw Object.assign(new Error('绑定服务下已存在同名平台配置'), { statusCode: 409 });
}
