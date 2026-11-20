import { executeInputSchema } from '@reqster/shared';
import type { FastifyInstance } from 'fastify';
import { executeRequest } from '../engine/executor.js';
import { parseBody } from './helpers.js';

export function executeRoutes(app: FastifyInstance): void {
  app.post('/execute', async (req, reply) => {
    const body = parseBody(executeInputSchema, req.body, reply);
    if (!body) return;
    // UI bağlantıyı yanıttan önce keserse (İptal düğmesi) giden istek de iptal edilir
    const controller = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) controller.abort();
    };
    reply.raw.once('close', onClose);
    try {
      return await executeRequest(body, controller.signal);
    } finally {
      reply.raw.off('close', onClose);
    }
  });
}
