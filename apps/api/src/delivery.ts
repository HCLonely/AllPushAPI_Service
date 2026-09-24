import { Worker } from 'node:worker_threads';
import { DeliveryStatus, type ChannelConfig, type PushService, type Prisma } from '@prisma/client';
import { sanitizeErrorText } from './security.js';
import { platformKey } from './platforms.js';

type Target = ChannelConfig & { service: PushService };
type Result = { status?: number; message: string };
let active = 0;
const waiters: Array<() => void> = [];
async function acquire() {
  if (active >= 8) await new Promise<void>((resolve) => waiters.push(resolve));
  else active++;
}
function release() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

export async function sendIsolated(target: Target, options: unknown): Promise<Result> {
  // Cap the queue as well as active workers to keep memory bounded under load.
  if (waiters.length >= 64) return { message: '推送繁忙，请稍后重试' };
  await acquire();
  try {
    return await new Promise<Result>((resolve) => {
      const worker = new Worker(new URL('./push-worker.mjs', import.meta.url), {
        workerData: { platform: platformKey(target.platform), config: target.configPayload, options },
        resourceLimits: { maxOldGenerationSizeMb: 128 }
      });
      let settled = false;
      const finish = async (result: Result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await worker.terminate();
        resolve(result);
      };
      const timer = setTimeout(
        () => void finish({ message: '投递超时，结果可能未知；请确认收件结果后重试' }),
        target.service.timeoutMs
      );
      worker.once('message', (result: Result) => void finish(result));
      worker.once('error', () => void finish({ message: '推送工作线程异常' }));
      worker.once('exit', () => void finish({ message: '推送工作线程提前退出' }));
    });
  } finally {
    release();
  }
}

export async function deliver(
  configs: Target[],
  body: Record<string, unknown>,
  pushRequestId: string,
  userId: string,
  send = sendIsolated
): Promise<Prisma.PushDeliveryCreateManyInput[]> {
  const deliveries: Prisma.PushDeliveryCreateManyInput[] = [];
  // Preserve configured priority and avoid platform-based result matching entirely.
  for (const cfg of configs) {
    const started = Date.now();
    let result: Result;
    try {
      result = await send(cfg, { ...body, message: body.message || body.content || '' });
    } catch {
      result = { message: '投递失败' };
    }
    deliveries.push({
      pushRequestId,
      userId,
      serviceId: cfg.serviceId,
      channelConfigId: cfg.id,
      platform: cfg.platform,
      configName: cfg.configName,
      status: result.status === 200 ? DeliveryStatus.SUCCESS : DeliveryStatus.FAILED,
      responseCode: result.status,
      responseBody: JSON.stringify({ message: sanitizeErrorText(result.message).slice(0, 1000) }),
      latencyMs: Date.now() - started
    });
  }
  return deliveries;
}
