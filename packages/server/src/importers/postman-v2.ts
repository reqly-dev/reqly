import type {
  AuthConfig,
  HttpMethod,
  ImportReport,
  KeyValueItem,
  RequestBody,
} from '@reqster/shared';
import { HTTP_METHODS } from '@reqster/shared';
import { getDb } from '../db/connection.js';
import { createCollection } from '../db/repositories/collections.js';
import { createEnvironment } from '../db/repositories/environments.js';
import { createFolder } from '../db/repositories/folders.js';
import { createRequest } from '../db/repositories/requests.js';
import { upsertVariable } from '../db/repositories/variables.js';
import { msg } from '../i18n/context.js';

/* ---------- Postman şema tipleri (gevşek: dış veri) ---------- */

interface PmCollection {
  info?: { name?: string; description?: unknown; schema?: string };
  item?: PmItem[];
  variable?: PmVariable[];
  auth?: PmAuth;
  event?: PmEvent[];
}

interface PmItem {
  name?: string;
  item?: PmItem[];
  request?: PmRequest | string;
  event?: PmEvent[];
  auth?: PmAuth;
  description?: unknown;
}

interface PmRequest {
  method?: string;
  url?: PmUrl | string;
  header?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  body?: PmBody;
  auth?: PmAuth;
  description?: unknown;
}

interface PmUrl {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  port?: string;
  path?: string | string[];
  query?: Array<{ key?: string; value?: string; disabled?: boolean }>;
}

interface PmBody {
  mode?: string;
  raw?: string;
  urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  formdata?: Array<{ key?: string; value?: string; type?: string; disabled?: boolean }>;
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
}

/** v2.1'de alanlar [{key,value}] dizisi, v2.0'da düz nesnedir — ikisi de desteklenir */
type PmAuthParams = Array<{ key?: string; value?: unknown }> | Record<string, unknown>;

interface PmAuth {
  type?: string;
  bearer?: PmAuthParams;
  basic?: PmAuthParams;
  apikey?: PmAuthParams;
  [key: string]: unknown;
}

interface PmEvent {
  listen?: string;
  script?: { exec?: string | string[] };
}

interface PmEnvironment {
  name?: string;
  values?: Array<{ key?: string; value?: string; enabled?: boolean; type?: string }>;
}

/* ---------- Yardımcılar ---------- */

function descriptionText(d: unknown): string | null {
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && 'content' in d) return String((d as { content: unknown }).content);
  return null;
}

function authParam(params: PmAuthParams | undefined, key: string): string {
  if (!params) return '';
  if (Array.isArray(params)) {
    const found = params.find((p) => p.key === key);
    return found?.value != null ? String(found.value) : '';
  }
  const value = params[key];
  return value != null ? String(value) : '';
}

const RAW_LANGUAGE_TO_CONTENT_TYPE: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
  text: 'text/plain',
};

function scriptText(events: PmEvent[] | undefined, listen: string): string | null {
  const event = events?.find((e) => e.listen === listen);
  if (!event?.script?.exec) return null;
  const exec = event.script.exec;
  const text = Array.isArray(exec) ? exec.join('\n') : exec;
  return text.trim() === '' ? null : text;
}

/**
 * Desteklenmeyen pm.* çağrılarını statik tarar (TASARIM.md §6.3). Liste `scripting/pm-compat.ts`'in
 * sunduğu alt kümeyi yansıtır; `startsWith` ile eşleşir (`pm.response.to` → `pm.response.to.have.status`).
 */
const SUPPORTED_PM_CALLS = new Set([
  ...['environment', 'collectionVariables', 'globals'].flatMap((scope) =>
    ['get', 'set', 'unset', 'has', 'toObject'].map((op) => `pm.${scope}.${op}`),
  ),
  'pm.environment.name',
  'pm.variables.get',
  'pm.variables.has',
  'pm.variables.replaceIn',
  'pm.info',
  'pm.test',
  'pm.expect',
  'pm.sendRequest',
  'pm.response.json',
  'pm.response.text',
  'pm.response.code',
  'pm.response.status',
  'pm.response.responseTime',
  'pm.response.responseSize',
  'pm.response.headers',
  'pm.response.to',
  'pm.request.headers',
  'pm.request.url',
  'pm.request.method',
  'pm.request.body',
]);

function scanUnsupportedPmCalls(script: string | null, itemName: string, warnings: string[]): void {
  if (!script) return;
  const seen = new Set<string>();
  for (const match of script.matchAll(/pm\.\w+(?:\.\w+)*/g)) {
    const call = match[0];
    const normalized = [...SUPPORTED_PM_CALLS].find((s) => call.startsWith(s));
    if (!normalized && !seen.has(call)) {
      seen.add(call);
      warnings.push(msg('import.unsupportedScriptCall', { item: itemName, call }));
    }
  }
}

/* ---------- Dönüştürücüler ---------- */

const SUPPORTED_AUTH_TYPES = new Set(['bearer', 'basic', 'apikey', 'noauth']);

function convertAuth(
  auth: PmAuth | undefined,
  itemName: string,
  skipped: ImportReport['skipped'],
): AuthConfig | null {
  if (!auth?.type) return null;
  if (!SUPPORTED_AUTH_TYPES.has(auth.type)) {
    skipped.push({ item: itemName, reason: msg('import.unsupportedAuth', { type: auth.type }) });
    return null;
  }
  switch (auth.type) {
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', bearer: { token: authParam(auth.bearer, 'token') } };
    case 'basic':
      return {
        type: 'basic',
        basic: {
          username: authParam(auth.basic, 'username'),
          password: authParam(auth.basic, 'password'),
        },
      };
    case 'apikey': {
      const location = authParam(auth.apikey, 'in');
      return {
        type: 'apikey',
        apikey: {
          key: authParam(auth.apikey, 'key'),
          value: authParam(auth.apikey, 'value'),
          in: location === 'query' ? 'query' : 'header',
        },
      };
    }
    default:
      return null;
  }
}

function convertUrl(url: PmUrl | string | undefined): { url: string; params: KeyValueItem[] } {
  if (url == null) return { url: '', params: [] };
  if (typeof url === 'string') return { url, params: [] };

  const params: KeyValueItem[] = (url.query ?? []).map((q) => ({
    key: q.key ?? '',
    value: q.value ?? '',
    enabled: q.disabled !== true,
  }));

  let base: string;
  if (url.raw) {
    // Query string raw içinde de bulunur; çift eklememek için ayrıştırılıp atılır
    base = params.length > 0 ? url.raw.split('?')[0]! : url.raw;
  } else {
    const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
    const path = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '');
    const protocol = url.protocol ? `${url.protocol}://` : '';
    const port = url.port ? `:${url.port}` : '';
    base = `${protocol}${host}${port}${path ? `/${path}` : ''}`;
  }
  return { url: base, params };
}

function convertBody(
  body: PmBody | undefined,
  itemName: string,
  skipped: ImportReport['skipped'],
  warnings: string[],
): RequestBody | null {
  if (!body?.mode) return null;
  switch (body.mode) {
    case 'raw': {
      const language = body.options?.raw?.language ?? 'text';
      return {
        mode: 'raw',
        raw: body.raw ?? '',
        contentType: RAW_LANGUAGE_TO_CONTENT_TYPE[language] ?? 'text/plain',
      };
    }
    case 'urlencoded':
      return {
        mode: 'urlencoded',
        items: (body.urlencoded ?? []).map((i) => ({
          key: i.key ?? '',
          value: i.value ?? '',
          enabled: i.disabled !== true,
        })),
      };
    case 'formdata': {
      const items: KeyValueItem[] = [];
      for (const field of body.formdata ?? []) {
        if (field.type === 'file') {
          // Güvenlik gereği dosya yolları içe alınmaz (TASARIM.md §6.2)
          skipped.push({
            item: itemName,
            reason: msg('import.formDataFileSkipped', { key: field.key ?? '' }),
          });
          continue;
        }
        items.push({ key: field.key ?? '', value: field.value ?? '', enabled: field.disabled !== true });
      }
      return { mode: 'form-data', items };
    }
    case 'graphql': {
      warnings.push(msg('import.graphqlDowngraded', { item: itemName }));
      return {
        mode: 'raw',
        raw: JSON.stringify(
          { query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '' },
          null,
          2,
        ),
        contentType: 'application/json',
      };
    }
    case 'file':
      skipped.push({ item: itemName, reason: msg('import.fileBodySkipped') });
      return null;
    default:
      warnings.push(msg('import.unknownBodyMode', { item: itemName, mode: body.mode }));
      return null;
  }
}

/* ---------- Rapor yardımcıları (postman-api.ts ve bundle.ts de kullanır) ---------- */

export function emptyImportReport(): ImportReport {
  return { collections: 0, folders: 0, requests: 0, variables: 0, environments: 0, skipped: [], warnings: [] };
}

/** `part`'ın sayılarını ve listelerini `total`'a ekler */
export function mergeImportReport(total: ImportReport, part: ImportReport): void {
  total.collections += part.collections;
  total.folders += part.folders;
  total.requests += part.requests;
  total.variables += part.variables;
  total.environments += part.environments;
  total.skipped.push(...part.skipped);
  total.warnings.push(...part.warnings);
}

/* ---------- Ana import akışları ---------- */

interface PmVariable {
  key?: string;
  value?: string;
  type?: string;
  disabled?: boolean;
}

export function importPostmanCollection(json: unknown, workspaceId: string): ImportReport {
  const report = emptyImportReport();

  const pm = json as PmCollection;
  if (!pm?.info?.name || !Array.isArray(pm.item)) {
    throw new Error(msg('import.invalidCollection'));
  }
  const schema = pm.info.schema ?? '';
  if (!schema.includes('v2.0') && !schema.includes('v2.1')) {
    report.warnings.push(msg('import.schemaUnknown', { schema: schema || msg('import.schemaUnspecified') }));
  }

  const db = getDb();
  // Atomiklik (TASARIM.md §6.1): hata olursa hiçbir şey yazılmaz
  db.transaction(() => {
    const collectionName = pm.info!.name!;
    const preScript = scriptText(pm.event, 'prerequest');
    const postScript = scriptText(pm.event, 'test');
    scanUnsupportedPmCalls(preScript, collectionName, report.warnings);
    scanUnsupportedPmCalls(postScript, collectionName, report.warnings);

    const collection = createCollection({
      workspaceId,
      name: collectionName,
      description: descriptionText(pm.info!.description),
      auth: convertAuth(pm.auth, collectionName, report.skipped),
      preRequestScript: preScript,
      postResponseScript: postScript,
    });
    report.collections += 1;

    for (const variable of pm.variable ?? []) {
      if (!variable.key) continue;
      upsertVariable({
        scope: 'collection',
        ownerId: collection.id,
        key: variable.key,
        value: variable.value ?? '',
        isSecret: variable.type === 'secret',
        enabled: variable.disabled !== true,
      });
      report.variables += 1;
    }

    walkItems(pm.item!, collection.id, null, report);
  })();

  return report;
}

function walkItems(
  items: PmItem[],
  collectionId: string,
  parentFolderId: string | null,
  report: ImportReport,
): void {
  items.forEach((item, index) => {
    const name = item.name ?? '(isimsiz)';

    if (Array.isArray(item.item)) {
      // Klasör: içinde item[] olan düğüm (özyinelemeli)
      const preScript = scriptText(item.event, 'prerequest');
      const postScript = scriptText(item.event, 'test');
      scanUnsupportedPmCalls(preScript, name, report.warnings);
      scanUnsupportedPmCalls(postScript, name, report.warnings);

      const folder = createFolder({
        collectionId,
        parentId: parentFolderId,
        name,
        description: descriptionText(item.description),
        auth: convertAuth(item.auth, name, report.skipped),
        preRequestScript: preScript,
        postResponseScript: postScript,
        sortOrder: index,
      });
      report.folders += 1;
      walkItems(item.item, collectionId, folder.id, report);
      return;
    }

    if (item.request == null) {
      report.skipped.push({ item: name, reason: msg('import.unknownItem') });
      return;
    }

    const pmRequest: PmRequest =
      typeof item.request === 'string' ? { method: 'GET', url: item.request } : item.request;

    const methodRaw = (pmRequest.method ?? 'GET').toUpperCase();
    const method = (HTTP_METHODS as readonly string[]).includes(methodRaw)
      ? (methodRaw as HttpMethod)
      : null;
    if (!method) {
      report.skipped.push({ item: name, reason: msg('import.unsupportedMethod', { method: methodRaw }) });
      return;
    }

    const { url, params } = convertUrl(pmRequest.url);
    const headers: KeyValueItem[] = (pmRequest.header ?? []).map((h) => ({
      key: h.key ?? '',
      value: h.value ?? '',
      enabled: h.disabled !== true,
    }));

    const preScript = scriptText(item.event, 'prerequest');
    const postScript = scriptText(item.event, 'test');
    scanUnsupportedPmCalls(preScript, name, report.warnings);
    scanUnsupportedPmCalls(postScript, name, report.warnings);

    createRequest({
      collectionId,
      folderId: parentFolderId,
      name,
      description: descriptionText(pmRequest.description),
      method,
      url,
      headers,
      params,
      body: convertBody(pmRequest.body, name, report.skipped, report.warnings),
      auth: convertAuth(pmRequest.auth, name, report.skipped),
      preRequestScript: preScript,
      postResponseScript: postScript,
      sortOrder: index,
    });
    report.requests += 1;
  });
}

export function importPostmanEnvironment(json: unknown, workspaceId: string): ImportReport {
  const report = emptyImportReport();

  const pmEnv = json as PmEnvironment;
  if (!pmEnv?.name || !Array.isArray(pmEnv.values)) {
    throw new Error(msg('import.invalidEnvironment'));
  }

  const db = getDb();
  db.transaction(() => {
    const environment = createEnvironment(workspaceId, pmEnv.name!);
    report.environments += 1;
    for (const value of pmEnv.values!) {
      if (!value.key) continue;
      upsertVariable({
        scope: 'environment',
        ownerId: environment.id,
        key: value.key,
        value: value.value ?? '',
        isSecret: value.type === 'secret',
        enabled: value.enabled !== false,
      });
      report.variables += 1;
    }
  })();

  return report;
}

/**
 * Postman global değişkenleri (Postman API `GET /workspaces/{id}/global-variables` yanıtındaki `values[]`
 * ya da globals export dosyasındaki `values[]`) → Reqster global değişkenleri (workspace scope).
 * Aynı anahtar varsa üzerine yazar (`upsertVariable`); tek transaction.
 */
export function importPostmanGlobals(values: unknown, workspaceId: string): ImportReport {
  const report = emptyImportReport();

  if (!Array.isArray(values)) {
    throw new Error(msg('import.invalidGlobals'));
  }
  const list = values as NonNullable<PmEnvironment['values']>;

  const db = getDb();
  db.transaction(() => {
    for (const value of list) {
      if (!value?.key) continue;
      upsertVariable({
        scope: 'global',
        ownerId: workspaceId,
        key: value.key,
        value: value.value ?? '',
        isSecret: value.type === 'secret',
        enabled: value.enabled !== false,
      });
      report.variables += 1;
    }
  })();

  return report;
}
