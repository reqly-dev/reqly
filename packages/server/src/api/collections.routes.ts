import type { CollectionTree } from '@reqster/shared';
import { hierarchyPatchSchema, nameSchema } from '@reqster/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  updateCollection,
} from '../db/repositories/collections.js';
import {
  createFolder,
  deleteFolder,
  getFolder,
  listFoldersByCollection,
  updateFolder,
} from '../db/repositories/folders.js';
import { listRequestsByCollection } from '../db/repositories/requests.js';
import { getDefaultWorkspace } from '../db/repositories/workspaces.js';
import { duplicateCollection, duplicateFolder } from '../core/duplicate.js';
import { msg } from '../i18n/context.js';
import { parseBody } from './helpers.js';

const createFolderSchema = z.object({
  collectionId: z.string(),
  parentId: z.string().nullable().default(null),
  name: z.string().min(1),
});

export function collectionsRoutes(app: FastifyInstance): void {
  app.get('/collections', () => {
    const workspace = getDefaultWorkspace();
    const trees: CollectionTree[] = listCollections(workspace.id).map((collection) => ({
      collection,
      folders: listFoldersByCollection(collection.id),
      requests: listRequestsByCollection(collection.id),
    }));
    return trees;
  });

  app.post('/collections', (req, reply) => {
    const body = parseBody(nameSchema, req.body, reply);
    if (!body) return;
    const workspace = getDefaultWorkspace();
    reply.code(201);
    return createCollection({ workspaceId: workspace.id, name: body.name });
  });

  app.patch('/collections/:id', (req, reply) => {
    const body = parseBody(hierarchyPatchSchema, req.body, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!getCollection(id)) return reply.code(404).send({ error: msg('error.collectionNotFound') });
    const updated = updateCollection(id, body);
    if (!updated) return reply.code(404).send({ error: msg('error.collectionNotFound') });
    return updated;
  });

  app.delete('/collections/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getCollection(id)) return reply.code(404).send({ error: msg('error.collectionNotFound') });
    deleteCollection(id);
    return { ok: true };
  });

  app.post('/collections/:id/duplicate', (req, reply) => {
    const { id } = req.params as { id: string };
    const copy = duplicateCollection(id);
    if (!copy) return reply.code(404).send({ error: msg('error.collectionNotFound') });
    reply.code(201);
    return copy;
  });

  app.post('/folders/:id/duplicate', (req, reply) => {
    const { id } = req.params as { id: string };
    const copy = duplicateFolder(id);
    if (!copy) return reply.code(404).send({ error: msg('error.folderNotFound') });
    reply.code(201);
    return copy;
  });

  app.post('/folders', (req, reply) => {
    const body = parseBody(createFolderSchema, req.body, reply);
    if (!body) return;
    if (!getCollection(body.collectionId)) {
      return reply.code(404).send({ error: msg('error.collectionNotFound') });
    }
    reply.code(201);
    return createFolder(body);
  });

  app.patch('/folders/:id', (req, reply) => {
    const body = parseBody(hierarchyPatchSchema, req.body, reply);
    if (!body) return;
    const { id } = req.params as { id: string };
    if (!getFolder(id)) return reply.code(404).send({ error: msg('error.folderNotFound') });
    const updated = updateFolder(id, body);
    if (!updated) return reply.code(404).send({ error: msg('error.folderNotFound') });
    return updated;
  });

  app.delete('/folders/:id', (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getFolder(id)) return reply.code(404).send({ error: msg('error.folderNotFound') });
    deleteFolder(id);
    return { ok: true };
  });
}
