import { createServer } from '../apps/api/dist/server.js';

let app: any = null;

export default async function handler(req: any, res: any) {
  if (!app) {
    app = await createServer();
    await app.ready();
  }
  app.server.emit('request', req, res);
}
