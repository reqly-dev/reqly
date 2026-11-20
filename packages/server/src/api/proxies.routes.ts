import { proxyActivateSchema, proxyPatchSchema, proxyUpsertSchema } from '@reqster/shared';
import type { FastifyInstance } from 'fastify';
import {
  createProxy,
  deleteProxy,
  getProxy,
  listProxies,
  setActiveProxy,
  updateProxy,
} from '../db/repositories/proxies.js';
import { msg } from '../i18n/context.js';
import { parseBody } from './helpers.js';

const notFound = () => ({ error: msg('error.proxyNotFound') });

export function proxiesRoutes(app: FastifyInstance): void {
  app.get('/proxies', () => listProxies());

  app.post('/proxies', (req, reply) => {
    const body = parseBody(proxyUpsertSchema, req.body, reply);
    if (!body) return;
    reply.code(201);
    return createProxy(body);
  });

  app.patch('/proxies/:id', (req, reply) => {
    const body = parseBody(proxyPatchSchema, req.body, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    const updated = updateProxy(id, body);
    if (!updated) return reply.code(404).send(notFound());
    return updated;
  });

  app.delete('/proxies/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getProxy(id)) return reply.code(404).send(notFound());
    deleteProxy(id);
    return reply.code(204).send();
  });

  // `{ id: null }` → proxy yok; yanıt güncel liste (isActive bayrakları değişmiş olur)
  app.put('/proxies/active', (req, reply) => {
    const body = parseBody(proxyActivateSchema, req.body, reply);
    if (!body) return;
    if (body.id && !getProxy(body.id)) return reply.code(404).send(notFound());
    setActiveProxy(body.id);
    return listProxies();
  });
}
