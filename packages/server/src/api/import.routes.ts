import { curlImportSchema, postmanApiImportSchema, postmanApiInventorySchema } from '@reqster/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getDefaultWorkspace } from '../db/repositories/workspaces.js';
import {
  fetchPostmanInventory,
  importFromPostmanApi,
  PostmanApiError,
} from '../importers/postman-api.js';
import { importBundle, isReqsterBundle } from '../importers/bundle.js';
import { CurlParseError, parseCurl } from '../importers/curl.js';
import { importPostmanCollection, importPostmanEnvironment } from '../importers/postman-v2.js';
import { parseBody } from './helpers.js';

/** Anahtar reddi 401, Postman API'ye ulaşılamama/hata 502, beklenmeyen 500 — mesajlar anahtar içermez */
function sendPostmanApiError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof PostmanApiError) {
    return reply.code(err.kind === 'auth' ? 401 : 502).send({ error: err.message });
  }
  return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
}

export function importRoutes(app: FastifyInstance): void {
  // Body: Postman export dosyasının JSON içeriği (olduğu gibi). "Dosyadan…" tek kapı olsun diye bir
  // Reqster paketi (`format: "reqster-bundle"`) seçilirse paket importer'ına yönlenir.
  app.post('/import/postman', (req, reply) => {
    const workspace = getDefaultWorkspace();
    try {
      if (isReqsterBundle(req.body)) return importBundle(req.body, workspace.id);
      return importPostmanCollection(req.body, workspace.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Body: `.reqster.json` paketi (ReqsterBundle). Tek transaction: bir parça bozuksa hiçbir şey yazılmaz.
  app.post('/import/bundle', (req, reply) => {
    const workspace = getDefaultWorkspace();
    try {
      return importBundle(req.body, workspace.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Yapıştırılan cURL komutu → kaydedilmemiş taslak (DB'ye yazılmaz; sekmeye UI koyar)
  app.post('/import/curl', (req, reply) => {
    const body = parseBody(curlImportSchema, req.body, reply);
    if (!body) return;
    try {
      return parseCurl(body.command);
    } catch (err) {
      if (err instanceof CurlParseError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/import/postman-environment', (req, reply) => {
    const workspace = getDefaultWorkspace();
    try {
      return importPostmanEnvironment(req.body, workspace.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Postman API anahtarı yalnızca bu iki isteğin gövdesinde yaşar: saklanmaz, loglanmaz
  // (Fastify logger 'warn' seviyesinde ve gövde hiçbir seviyede loglanmaz).
  app.post('/import/postman-api/inventory', async (req, reply) => {
    const body = parseBody(postmanApiInventorySchema, req.body, reply);
    if (!body) return;
    try {
      return await fetchPostmanInventory(body.apiKey);
    } catch (err) {
      return sendPostmanApiError(err, reply);
    }
  });

  app.post('/import/postman-api', async (req, reply) => {
    const body = parseBody(postmanApiImportSchema, req.body, reply);
    if (!body) return;
    const workspace = getDefaultWorkspace();
    try {
      return await importFromPostmanApi(body, workspace.id);
    } catch (err) {
      return sendPostmanApiError(err, reply);
    }
  });
}
