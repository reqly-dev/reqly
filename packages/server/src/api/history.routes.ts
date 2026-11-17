import type { FastifyInstance } from 'fastify';
import { clearHistory, getHistoryDetail, listHistory } from '../db/repositories/history.js';
import { getDefaultWorkspace } from '../db/repositories/workspaces.js';
import { msg } from '../i18n/context.js';

export function historyRoutes(app: FastifyInstance): void {
  app.get('/history', (req) => {
    const workspace = getDefaultWorkspace();
    const { limit } = req.query as { limit?: string };
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    return listHistory(workspace.id, Number.isNaN(parsed) ? 100 : Math.min(parsed, 500));
  });

  app.get('/history/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = getHistoryDetail(id);
    if (!detail) return reply.code(404).send({ error: msg('error.historyNotFound') });
    return detail;
  });

  app.delete('/history', () => {
    const workspace = getDefaultWorkspace();
    clearHistory(workspace.id);
    return { ok: true };
  });
}
