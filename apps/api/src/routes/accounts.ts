import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserRole, UserStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { loginSchema, registerSchema, createUserSchema } from '../schemas.js';
import { AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW } from '../config.js';

export function registerAccountsRoutes(
  app: FastifyInstance,
  verifyJwt: preHandlerHookHandler,
  requireAdmin: preHandlerHookHandler
) {
  app.get('/health', async () => ({ ok: true }));

  app.post(
    '/api/v1/auth/login',
    {
      config: { rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW } }
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { username: body.username } });
      if (!user || user.status !== UserStatus.ACTIVE)
        return reply.code(401).send({ message: '用户名或密码错误' });
      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) return reply.code(401).send({ message: '用户名或密码错误' });
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      const accessToken = await reply.jwtSign(
        { id: user.id, username: user.username, role: user.role },
        { expiresIn: '7d' }
      );
      return { accessToken, user: { id: user.id, username: user.username, role: user.role } };
    }
  );

  app.post(
    '/api/v1/auth/register',
    {
      config: { rateLimit: { max: AUTH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_WINDOW } }
    },
    async (request, reply) => {
      if (process.env.ALLOW_REGISTRATION === 'false')
        return reply.code(403).send({ message: '注册已关闭，请联系管理员' });
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
      return reply
        .code(201)
        .send({ id: user.id, username: user.username, role: user.role, status: user.status });
    }
  );

  app.get('/api/v1/auth/me', { preHandler: [verifyJwt] }, async (request: any) => {
    const user = request.currentUser;
    return { user: { id: user.id, username: user.username, role: user.role, status: user.status } };
  });
  app.get('/api/v1/admin/users', { preHandler: [verifyJwt, requireAdmin] }, async () => {
    const items = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return {
      items: items.map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        status: u.status,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt
      }))
    };
  });

  app.post('/api/v1/admin/users', { preHandler: [verifyJwt, requireAdmin] }, async (request) => {
    const body = createUserSchema.parse(request.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: { username: body.username, passwordHash, role: body.role as UserRole, status: UserStatus.ACTIVE }
    });
    return { id: user.id, username: user.username, role: user.role, status: user.status };
  });

  app.patch(
    '/api/v1/admin/users/:id/status',
    { preHandler: [verifyJwt, requireAdmin] },
    async (request: any, reply) => {
      const status = z.enum(['ACTIVE', 'DISABLED']).parse((request.body as any)?.status);
      const user = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!user) return reply.code(404).send({ message: '用户不存在' });
      if (status === 'DISABLED' && user.id === request.currentUser.id)
        return reply.code(400).send({ message: '不能禁用当前登录账号' });
      return prisma.user.update({
        where: { id: user.id },
        data: { status },
        select: { id: true, username: true, role: true, status: true }
      });
    }
  );
}
