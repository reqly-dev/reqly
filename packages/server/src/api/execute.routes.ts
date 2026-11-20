import { executeInputSchema } from '@reqster/shared';
import type { FastifyInstance } from 'fastify';
import { executeRequest } from '../engine/executor.js';
import { parseBody } from './helpers.js';

export function executeRoutes(app: FastifyInstance): void {
  app.post('/execute', async (req, reply) => {
    const body = parseBody(executeInputSchema, req.body, reply);
    if (!body) return;
    return executeRequest(body);
  });
}
