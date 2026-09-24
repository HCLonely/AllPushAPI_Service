import { createServer } from './server.js';
import { prisma } from './db.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | undefined;

const start = async () => {
  app = await createServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });
};

start().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 30000);
  deadline.unref();
  try {
    await app?.close();
    await prisma.$disconnect();
  } finally {
    clearTimeout(deadline);
  }
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
