import { requestUpsertSchema } from '@reqly/shared';
import type { FastifyInstance } from 'fastify';
import { getCollection } from '../db/repositories/collections.js';
import {
  createRequest,
  deleteRequest,
  getRequest,
  updateRequest,
} from '../db/repositories/requests.js';
import { duplicateRequest } from '../core/duplicate.js';
import { msg } from '../i18n/context.js';
import { parseBody } from './helpers.js';

export function requestsRoutes(app: FastifyInstance): void {
  app.post('/requests', (req, reply) => {
    const body = parseBody(requestUpsertSchema, req.body, reply);
    if (!body) return;
    if (!getCollection(body.collectionId)) {
      return reply.code(404).send({ error: msg('error.collectionNotFound') });
    }
    reply.code(201);
    return createRequest(body);
  });

  app.patch('/requests/:id', (req, reply) => {
    const body = parseBody(requestUpsertSchema, req.body, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    const updated = updateRequest(id, body);
    if (!updated) return reply.code(404).send({ error: msg('error.requestNotFound') });
    return updated;
  });

  app.post('/requests/:id/duplicate', (req, reply) => {
    const { id } = req.params as { id: string };
    const copy = duplicateRequest(id);
    if (!copy) return reply.code(404).send({ error: msg('error.requestNotFound') });
    reply.code(201);
    return copy;
  });

  app.delete('/requests/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getRequest(id)) return reply.code(404).send({ error: msg('error.requestNotFound') });
    deleteRequest(id);
    return { ok: true };
  });
}
