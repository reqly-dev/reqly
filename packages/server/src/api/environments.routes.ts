import { nameSchema, variableUpsertSchema } from '@reqly/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  activateEnvironment,
  createEnvironment,
  deleteEnvironment,
  getEnvironment,
  listEnvironments,
  renameEnvironment,
} from '../db/repositories/environments.js';
import { deleteVariable, getVariable, listVariables, upsertVariable } from '../db/repositories/variables.js';
import { getDefaultWorkspace } from '../db/repositories/workspaces.js';
import { listResolvedVariables } from '../core/variables/resolve.js';
import { duplicateEnvironment } from '../core/duplicate.js';
import { msg } from '../i18n/context.js';
import { parseBody } from './helpers.js';

const activateSchema = z.object({ environmentId: z.string().nullable() });

const listVariablesQuerySchema = z.object({
  scope: z.enum(['environment', 'collection', 'global']),
  ownerId: z.string().optional(),
});

export function environmentsRoutes(app: FastifyInstance): void {
  app.get('/environments', () => {
    const workspace = getDefaultWorkspace();
    return listEnvironments(workspace.id);
  });

  app.post('/environments', (req, reply) => {
    const body = parseBody(nameSchema, req.body, reply);
    if (!body) return;
    const workspace = getDefaultWorkspace();
    reply.code(201);
    return createEnvironment(workspace.id, body.name);
  });

  app.patch('/environments/:id', (req, reply) => {
    const body = parseBody(nameSchema, req.body, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    const updated = renameEnvironment(id, body.name);
    if (!updated) return reply.code(404).send({ error: msg('error.environmentNotFound') });
    return updated;
  });

  app.post('/environments/:id/duplicate', (req, reply) => {
    const { id } = req.params as { id: string };
    const copy = duplicateEnvironment(id);
    if (!copy) return reply.code(404).send({ error: msg('error.environmentNotFound') });
    reply.code(201);
    return copy;
  });

  app.delete('/environments/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getEnvironment(id)) return reply.code(404).send({ error: msg('error.environmentNotFound') });
    deleteEnvironment(id);
    return { ok: true };
  });

  app.post('/environments/activate', (req, reply) => {
    const body = parseBody(activateSchema, req.body, reply);
    if (!body) return;
    const workspace = getDefaultWorkspace();
    if (body.environmentId && !getEnvironment(body.environmentId)) {
      return reply.code(404).send({ error: msg('error.environmentNotFound') });
    }
    activateEnvironment(workspace.id, body.environmentId);
    return { ok: true };
  });

  // Tooltip için: ortam → koleksiyon → global önceliğiyle çözülmüş tekil liste
  app.get('/variables/resolved', (req) => {
    const workspace = getDefaultWorkspace();
    const { collectionId } = req.query as { collectionId?: string };
    return listResolvedVariables(workspace.id, collectionId || undefined);
  });

  app.get('/variables', (req, reply) => {
    const query = parseBody(listVariablesQuerySchema, req.query, reply);
    if (!query) return;
    const workspace = getDefaultWorkspace();
    // global scope'ta owner her zaman workspace'tir; diğerlerinde ownerId zorunlu
    const ownerId = query.scope === 'global' ? workspace.id : query.ownerId;
    if (!ownerId) return reply.code(400).send({ error: msg('error.ownerIdRequired') });
    return listVariables(query.scope, ownerId);
  });

  app.put('/variables', (req, reply) => {
    const body = parseBody(variableUpsertSchema, req.body, reply);
    if (!body) return;
    const workspace = getDefaultWorkspace();
    const ownerId = body.scope === 'global' ? workspace.id : body.ownerId;
    return upsertVariable({ ...body, ownerId });
  });

  app.delete('/variables/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getVariable(id)) return reply.code(404).send({ error: msg('error.variableNotFound') });
    deleteVariable(id);
    return { ok: true };
  });
}
