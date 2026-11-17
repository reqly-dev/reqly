import { z } from 'zod';
import { HTTP_METHODS } from '../constants/index.js';

/*
 * Özel zod mesajları dil bilmez: `validation.*` biçiminde sunucu sözlüğü anahtarıdır
 * (`packages/server/src/i18n/messages.ts`), sunucu `parseBody` içinde istek diline çevirir.
 * Mesaj verilmeyen kurallarda zod'un İngilizce varsayılanı kalır.
 */

export const keyValueItemSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
});

export const requestBodySchema = z.object({
  mode: z.enum(['none', 'raw', 'urlencoded', 'form-data']),
  raw: z.string().optional(),
  contentType: z.string().optional(),
  items: z.array(keyValueItemSchema).optional(),
});

export const authConfigSchema = z.object({
  type: z.enum(['none', 'bearer', 'basic', 'apikey']),
  bearer: z.object({ token: z.string() }).optional(),
  basic: z.object({ username: z.string(), password: z.string() }).optional(),
  apikey: z
    .object({
      key: z.string(),
      value: z.string(),
      in: z.enum(['header', 'query']),
    })
    .optional(),
});

export const executeInputSchema = z.object({
  requestId: z.string().optional(),
  collectionId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  method: z.enum(HTTP_METHODS),
  url: z.string().min(1, 'validation.urlRequired'),
  headers: z.array(keyValueItemSchema).default([]),
  params: z.array(keyValueItemSchema).default([]),
  body: requestBodySchema.nullable().default(null),
  auth: authConfigSchema.nullable().default(null),
  preRequestScript: z.string().nullable().optional(),
  postResponseScript: z.string().nullable().optional(),
});

export const requestUpsertSchema = z.object({
  collectionId: z.string(),
  folderId: z.string().nullable().default(null),
  name: z.string().min(1),
  description: z.string().nullable().default(null),
  method: z.enum(HTTP_METHODS),
  url: z.string().default(''),
  headers: z.array(keyValueItemSchema).default([]),
  params: z.array(keyValueItemSchema).default([]),
  body: requestBodySchema.nullable().default(null),
  auth: authConfigSchema.nullable().default(null),
  preRequestScript: z.string().nullable().default(null),
  postResponseScript: z.string().nullable().default(null),
});

export const variableUpsertSchema = z.object({
  scope: z.enum(['environment', 'collection', 'global']),
  ownerId: z.string(),
  key: z.string().min(1),
  value: z.string().default(''),
  isSecret: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const nameSchema = z.object({ name: z.string().min(1) });

/**
 * PATCH /api/collections/:id ve /api/folders/:id gövdesi: koleksiyon/klasör düzeyi ayarlar
 * (ad, açıklama, pre/post script, auth). Hepsi isteğe bağlı; verilmeyen alan değişmez.
 * `auth: null` = koleksiyonda "auth yok", klasörde "üstten devral".
 */
export const hierarchyPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    preRequestScript: z.string().nullable().optional(),
    postResponseScript: z.string().nullable().optional(),
    auth: authConfigSchema.nullable().optional(),
  })
  .strict();
export type HierarchyPatch = z.infer<typeof hierarchyPatchSchema>;

/**
 * PATCH /api/settings gövdesi: yalnızca kullanıcıya açılan anahtarlar, hepsi isteğe bağlı.
 * `.strict()` tanınmayan anahtarı 400'e düşürür. Değer tipleri DEFAULT_SETTINGS ile aynıdır.
 */
export const settingsPatchSchema = z
  .object({
    'network.verify_tls': z.boolean().optional(),
    'network.reuse_connections': z.boolean().optional(),
    'network.timeout_ms': z.number().int().min(0).max(600_000).optional(), // 0 = sınırsız (hata ayıklama)
    'network.max_redirects': z.number().int().min(0).max(50).optional(),
    // UI tercihleri (tema, bölme boyutları) — bkz. DEFAULT_SETTINGS
    'ui.theme': z.enum(['dark', 'light']).optional(),
    'ui.sidebar_width': z.number().int().min(100).max(2000).optional(),
    'ui.request_pane_ratio': z.number().min(0.05).max(0.95).optional(),
    'ui.language': z.enum(['auto', 'tr', 'en']).optional(),
    // Masaüstü kabuğunun açılıştaki sürüm denetimi — bkz. DEFAULT_SETTINGS
    'update.auto_check': z.boolean().optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/* ---------- Proxy ---------- */

const proxyUrlSchema = z
  .string()
  .trim()
  .url('validation.proxyUrlInvalid')
  .refine((u) => /^https?:\/\//i.test(u), 'validation.proxyUrlScheme');

/** POST /api/proxies gövdesi */
export const proxyUpsertSchema = z
  .object({
    name: z.string().trim().min(1, 'validation.nameRequired'),
    url: proxyUrlSchema,
    username: z.string().nullable().default(null),
    /** undefined = dokunma (PATCH), null ya da '' = parolayı temizle */
    password: z.string().nullable().optional(),
    bypass: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();
export type ProxyUpsert = z.infer<typeof proxyUpsertSchema>;

/** PATCH /api/proxies/:id gövdesi: tüm alanlar isteğe bağlı, verilmeyen dokunulmaz */
export const proxyPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'validation.nameRequired').optional(),
    url: proxyUrlSchema.optional(),
    username: z.string().nullable().optional(),
    password: z.string().nullable().optional(),
    bypass: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();
export type ProxyPatch = z.infer<typeof proxyPatchSchema>;

/** PUT /api/proxies/active gövdesi; `null` = proxy yok */
export const proxyActivateSchema = z.object({ id: z.string().nullable() }).strict();

/* ---------- Postman API ---------- */

const postmanApiKeySchema = z.string().trim().min(1, 'validation.postmanApiKeyRequired');

/** POST /api/import/postman-api/inventory gövdesi */
export const postmanApiInventorySchema = z.object({ apiKey: postmanApiKeySchema }).strict();

/** POST /api/import/postman-api gövdesi */
export const postmanApiImportSchema = z
  .object({
    apiKey: postmanApiKeySchema,
    collectionUids: z.array(z.string().min(1)).default([]),
    environmentUids: z.array(z.string().min(1)).default([]),
    /** Bu workspace'lerin global değişkenleri Reqly global'lerine aktarılır */
    globalsWorkspaceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type PostmanApiImportInput = z.infer<typeof postmanApiImportSchema>;

/* ---------- Dışa aktarma ---------- */

/** POST /api/export/bundle gövdesi */
export const bundleExportSchema = z
  .object({
    collectionIds: z.array(z.string().min(1)).default([]),
    environmentIds: z.array(z.string().min(1)).default([]),
    includeGlobals: z.boolean().default(false),
    /** false → secret değişkenler boş değerle ve type:"secret" ile gider */
    includeSecrets: z.boolean().default(false),
  })
  .strict();
export type BundleExportInput = z.infer<typeof bundleExportSchema>;

/** `POST /api/import/curl` — yapıştırılan komut (kaydetmez, taslak döner) */
export const curlImportSchema = z
  .object({ command: z.string().min(1, 'validation.curlRequired').max(1_048_576) })
  .strict();
export type CurlImportInput = z.infer<typeof curlImportSchema>;

/** `POST /api/export/curl` — taslağın o anki hali + çıktı biçimi */
export const curlExportSchema = executeInputSchema.extend({
  shell: z.enum(['bash', 'cmd']).default('bash'),
  /** false → `{{var}}` olduğu gibi kalır; true → değerler (secret dahil) yazılır */
  resolveVariables: z.boolean().default(false),
});
export type CurlExportInput = z.infer<typeof curlExportSchema>;
