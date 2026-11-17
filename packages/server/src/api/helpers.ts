import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { msg } from '../i18n/context.js';
import { isMessageKey } from '../i18n/messages.js';

/**
 * Zod doğrulaması; hata halinde 400 döner ve null verir. Shared şemalar mesaj olarak sözlük
 * anahtarı taşır (`validation.urlRequired` gibi); anahtar olanlar istek diline çevrilir, zod'un
 * kendi varsayılan (İngilizce) mesajları olduğu gibi kalır.
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  reply: FastifyReply,
): z.infer<T> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.code(400).send({
      error: msg('validation.failed'),
      details: result.error.issues.map(
        (i) => `${i.path.join('.')}: ${isMessageKey(i.message) ? msg(i.message) : i.message}`,
      ),
    });
    return null;
  }
  return result.data;
}
