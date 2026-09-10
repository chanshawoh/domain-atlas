import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProjectionError, readAtlas } from './query.js';

export async function createWebServer(projectRoot: string, webRoot = fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url))) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request, reply) => {
    const hostname = request.hostname.toLowerCase();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return reply.code(403).send({ message: '仅允许本地访问' });
    const origin = request.headers.origin;
    if (origin) {
      try {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) return reply.code(403).send({ message: '仅允许本地来源' });
      } catch { return reply.code(403).send({ message: '无效来源' }); }
    }
    reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProjectionError) return reply.code(500).send({ code: error.code, message: error.message });
    return reply.code(500).send({ code: 'SERVER_ERROR', message: '无法加载项目，请检查本地服务。' });
  });
  app.get('/api/atlas', async () => readAtlas(projectRoot));
  app.get<{ Params: { id: string } }>('/api/changes/:id', async (request, reply) => {
    const snapshot = await readAtlas(projectRoot);
    const record = snapshot.changes.find(item => item.id === request.params.id);
    if (!record) return reply.code(404).send({ message: '记录不存在' });
    return record;
  });
  try {
    await access(webRoot);
    await app.register(fastifyStatic, { root: webRoot });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    app.get('/', async (_request, reply) => reply.type('text/plain; charset=utf-8').send('请执行 pnpm build 构建 Web UI，或使用 pnpm dev:web 启动前端开发服务器。'));
  }
  return app;
}

export async function startWebServer(projectRoot: string, port: number): Promise<void> {
  const app = await createWebServer(projectRoot);
  const address = await app.listen({ host: '127.0.0.1', port });
  process.stdout.write('DomainAtlas Web UI: ' + address + '\n');
  const close = () => { void app.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
