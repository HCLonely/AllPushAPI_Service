import bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '@prisma/client';
import { prisma } from './db.js';
import { IS_PROD, LOG_RETENTION_DEFAULT_DAYS, toBoundedInt } from './config.js';
export async function getRetentionDays() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'log_retention_days' } });
  if (row) return toBoundedInt(row.value, LOG_RETENTION_DEFAULT_DAYS, 1, 3650);
  await prisma.systemSetting.upsert({
    where: { key: 'log_retention_days' },
    update: {},
    create: { key: 'log_retention_days', value: String(LOG_RETENTION_DEFAULT_DAYS) }
  });
  return LOG_RETENTION_DEFAULT_DAYS;
}

export async function cleanupLogs() {
  const days = await getRetentionDays();
  const cutoff = new Date(Date.now() - days * 86400000);
  await prisma.accessLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  await prisma.pushRequest.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

export async function ensureAdmin() {
  const count = await prisma.user.count({ where: { role: UserRole.ADMIN } });
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME || (IS_PROD ? '' : 'admin');
  const password = process.env.ADMIN_PASSWORD || '';
  if (
    !username ||
    !password ||
    (IS_PROD && (password.length < 12 || ['admin123', 'change-me'].includes(password)))
  ) {
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
