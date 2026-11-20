import type {
  ImportReport,
  PostmanApiImportInput,
  PostmanApiImportResult,
  PostmanInventory,
  PostmanInventoryItem,
  PostmanInventoryWorkspace,
} from '@reqster/shared';
import { type Dispatcher, request as undiciRequest } from 'undici';
import { getSetting } from '../db/repositories/settings.js';
import { createDispatcherFor, describeProxyError } from '../engine/dispatcher.js';
import { msg } from '../i18n/context.js';
import {
  emptyImportReport,
  importPostmanCollection,
  importPostmanEnvironment,
  importPostmanGlobals,
  mergeImportReport,
} from './postman-v2.js';

/**
 * Postman API'den (https://api.getpostman.com) toplu içe aktarma. Kullanıcının API anahtarı yalnızca
 * istek gövdesinde yaşar: saklanmaz, loglanmaz, hiçbir hata mesajına girmez (TASARIM.md §8).
 *
 * Yalnızca TEST amaçlı: `REQSTER_POSTMAN_API_BASE` ile taban adres sahte bir sunucuya çevrilebilir
 * (uçtan uca senaryolar gerçek Postman API'ye çıkmaz). Üretimde tanımlanmaz, varsayılan gerçek adrestir.
 */
const DEFAULT_API_BASE = 'https://api.getpostman.com';

/** Postman'in istek sınırı yanıtında (429) bir kez beklenip yeniden denenir */
const RATE_LIMIT_RETRY_DELAY_MS = 2000;
const INVENTORY_CONCURRENCY = 3;
const IMPORT_CONCURRENCY = 2;


/**
 * `auth`: anahtar reddedildi (route 401 döner, içe aktarma bütünüyle durur);
 * `upstream`: Postman API'ye ulaşılamadı ya da hata döndü (route 502).
 */
export class PostmanApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'upstream',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PostmanApiError';
  }
}

/* ---------- Postman API yanıt tipleri (gevşek: dış veri, savunmacı okunur) ---------- */

interface PmWorkspaceSummary {
  id?: string;
  name?: string;
  type?: string;
}

interface PmWorkspaceRef {
  id?: string;
  uid?: string;
  name?: string;
}

interface PmWorkspaceDetail extends PmWorkspaceSummary {
  collections?: PmWorkspaceRef[];
  environments?: PmWorkspaceRef[];
}

interface PmErrorBody {
  error?: { name?: string; message?: string };
}

/* ---------- İstemci ---------- */

/**
 * Tek bir toplu işlem için Postman API istemcisi: dispatcher'ı (ağ ayarları + varsa aktif proxy) bir kez
 * kurar, iş bitince `close()` ile kapatır. Proxy kimliği ProxyAgent'ın işidir; buraya başlık eklenmez.
 */
class PostmanApiClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly dispatcher: Dispatcher;
  private readonly proxyHost: string | undefined;
  private readonly release: () => void;

  constructor(private readonly apiKey: string) {
    this.base = (process.env.REQSTER_POSTMAN_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = getSetting('network.timeout_ms');
    const resolved = createDispatcherFor(new URL(this.base), {
      timeoutMs: this.timeoutMs,
      maxRedirects: getSetting('network.max_redirects'),
      verifyTls: getSetting('network.verify_tls'),
    });
    this.dispatcher = resolved.dispatcher;
    this.proxyHost = resolved.proxyHost;
    this.release = resolved.release;
  }

  /** `GET <base><path>`; JSON gövdeyi döner, 429'da bir kez bekleyip yeniden dener */
  async get(path: string): Promise<unknown> {
    const url = `${this.base}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.fetchJson(url);
      if (result.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS));
        continue;
      }
      if (result.status === 401 || result.status === 403) {
        throw new PostmanApiError(msg('postmanApi.authError'), 'auth', result.status);
      }
      if (result.status === 429) {
        throw new PostmanApiError(msg('postmanApi.rateLimited'), 'upstream', 429);
      }
      if (result.status >= 400) {
        const detail = (result.body as PmErrorBody | null)?.error?.message;
        throw new PostmanApiError(
          detail
            ? msg('postmanApi.statusErrorDetail', { status: result.status, detail })
            : msg('postmanApi.statusError', { status: result.status }),
          'upstream',
          result.status,
        );
      }
      return result.body;
    }
  }

  private async fetchJson(url: string): Promise<{ status: number; body: unknown }> {
    let status: number;
    let text: string;
    try {
      const res = await undiciRequest(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
        dispatcher: this.dispatcher,
        // 0 = sınırsız: AbortSignal.timeout(0) isteği hemen keserdi
        signal: this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined,
      });
      status = res.statusCode;
      text = await res.body.text();
    } catch (err) {
      throw new PostmanApiError(this.describeNetworkError(err), 'upstream');
    }
    if (text === '') return { status, body: null };
    try {
      return { status, body: JSON.parse(text) as unknown };
    } catch {
      // Hata durumlarında (ör. proxy'nin HTML hata sayfası) gövde JSON olmayabilir; durum kodu yeter
      if (status >= 400) return { status, body: null };
      throw new PostmanApiError(msg('postmanApi.invalidJson'), 'upstream', status);
    }
  }

  /** Anahtar hiçbir hata mesajına girmez: undici hataları yalnızca kod/adres taşır */
  private describeNetworkError(err: unknown): string {
    if (this.proxyHost) {
      const viaProxy = describeProxyError(err, this.proxyHost);
      if (viaProxy) return viaProxy;
    }
    const e = err as { name?: string; code?: string; cause?: { code?: string } };
    const code = e?.code ?? e?.cause?.code;
    // 0 (sınırsız) iken bu kodlar oluşmaz; "(0 ms zaman aşımı)" gibi anlamsız bir mesaj da üretilmez
    const timedOut = e?.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT';
    if (timedOut && this.timeoutMs > 0) {
      return msg('postmanApi.timeout', { ms: this.timeoutMs });
    }
    return code ? msg('postmanApi.connectFailed', { code }) : msg('postmanApi.connectFailedNoCode');
  }

  close(): void {
    this.release();
  }
}

/* ---------- Yardımcılar ---------- */

/** Dizi üzerinde en fazla `limit` eşzamanlı `fn`; sonuçlar giriş sırasıyla döner */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function toInventoryItems(refs: PmWorkspaceRef[] | undefined): PostmanInventoryItem[] {
  if (!Array.isArray(refs)) return [];
  const items: PostmanInventoryItem[] = [];
  for (const ref of refs) {
    const uid = ref?.uid ?? ref?.id;
    if (!uid) continue;
    items.push({ uid, name: ref.name ?? uid });
  }
  return items;
}

function emptyResult(): PostmanApiImportResult {
  return { ...emptyImportReport(), failed: [] };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ---------- Envanter ---------- */

/**
 * `GET /workspaces` → her workspace için `GET /workspaces/{id}` (koleksiyon ve ortam listeleri yalnızca
 * ayrıntı yanıtında gelir). Alan adları Postman API v1 belgelerine göre: `workspaces[{id,name,type}]`,
 * `workspace.collections[{id,uid,name}]`, `workspace.environments[{id,uid,name}]`.
 */
export async function fetchPostmanInventory(apiKey: string): Promise<PostmanInventory> {
  const client = new PostmanApiClient(apiKey);
  try {
    const list = (await client.get('/workspaces')) as { workspaces?: PmWorkspaceSummary[] } | null;
    const summaries = (Array.isArray(list?.workspaces) ? list.workspaces : []).filter(
      (w): w is PmWorkspaceSummary & { id: string } => typeof w?.id === 'string' && w.id !== '',
    );

    const workspaces = await mapLimit(summaries, INVENTORY_CONCURRENCY, async (summary) => {
      const detailBody = (await client.get(`/workspaces/${encodeURIComponent(summary.id)}`)) as {
        workspace?: PmWorkspaceDetail;
      } | null;
      const detail = detailBody?.workspace ?? {};
      const workspace: PostmanInventoryWorkspace = {
        id: summary.id,
        name: detail.name ?? summary.name ?? summary.id,
        type: detail.type ?? summary.type ?? '',
        collections: toInventoryItems(detail.collections),
        environments: toInventoryItems(detail.environments),
      };
      return workspace;
    });

    return { workspaces };
  } finally {
    client.close();
  }
}

/* ---------- İçe aktarma ---------- */

type ImportJob =
  | { kind: 'collection'; uid: string }
  | { kind: 'environment'; uid: string }
  | { kind: 'globals'; workspaceId: string };

interface JobOutcome {
  label: string;
  report?: ImportReport;
  /** Sıralı uygulanması gereken (global) veri: indirme paralel, yazma giriş sırasıyla */
  globals?: unknown[];
  error?: string;
}

/**
 * Seçilen koleksiyon/ortam/global'leri indirip mevcut importer'larla aktarır. Tek bir öğenin
 * çekilememesi ya da aktarılamaması diğerlerini durdurmaz; o öğe `failed`'e yazılır. Anahtar
 * reddedilirse (`PostmanApiError` `auth`) işlem bütünüyle kesilir ve hata çağırana fırlatılır.
 */
export async function importFromPostmanApi(
  input: PostmanApiImportInput,
  workspaceId: string,
): Promise<PostmanApiImportResult> {
  const result = emptyResult();
  const client = new PostmanApiClient(input.apiKey);

  const jobs: ImportJob[] = [
    ...input.collectionUids.map((uid): ImportJob => ({ kind: 'collection', uid })),
    ...input.environmentUids.map((uid): ImportJob => ({ kind: 'environment', uid })),
    ...input.globalsWorkspaceIds.map((id): ImportJob => ({ kind: 'globals', workspaceId: id })),
  ];

  try {
    const outcomes = await mapLimit(jobs, IMPORT_CONCURRENCY, (job) => runJob(client, job, workspaceId));

    // Global'ler giriş sırasıyla yazılır ki "aynı anahtar → sonuncu kazanır" belirlenebilir olsun
    const seenGlobalKeys = new Map<string, string>();
    for (const outcome of outcomes) {
      if (outcome.error !== undefined) {
        result.failed.push({ item: outcome.label, reason: outcome.error });
        continue;
      }
      if (outcome.report) mergeImportReport(result, outcome.report);
      if (outcome.globals) {
        try {
          noteDuplicateGlobals(outcome.globals, outcome.label, seenGlobalKeys, result.warnings);
          mergeImportReport(result, importPostmanGlobals(outcome.globals, workspaceId));
        } catch (err) {
          result.failed.push({ item: outcome.label, reason: errorMessage(err) });
        }
      }
    }
    return result;
  } finally {
    client.close();
  }
}

async function runJob(client: PostmanApiClient, job: ImportJob, workspaceId: string): Promise<JobOutcome> {
  let label = jobLabel(job, null);
  try {
    switch (job.kind) {
      case 'collection': {
        const body = (await client.get(`/collections/${encodeURIComponent(job.uid)}`)) as {
          collection?: { info?: { name?: string } };
        } | null;
        const collection = body?.collection;
        label = jobLabel(job, collection?.info?.name ?? null);
        return { label, report: importPostmanCollection(collection, workspaceId) };
      }
      case 'environment': {
        const body = (await client.get(`/environments/${encodeURIComponent(job.uid)}`)) as {
          environment?: { name?: string };
        } | null;
        const environment = body?.environment;
        label = jobLabel(job, environment?.name ?? null);
        return { label, report: importPostmanEnvironment(environment, workspaceId) };
      }
      case 'globals': {
        const body = (await client.get(
          `/workspaces/${encodeURIComponent(job.workspaceId)}/global-variables`,
        )) as { values?: unknown[] } | null;
        if (!Array.isArray(body?.values)) {
          throw new Error(msg('import.invalidGlobals'));
        }
        return { label, globals: body.values };
      }
    }
  } catch (err) {
    // Anahtar reddi tüm işlemi keser; diğer hatalar yalnızca bu öğeyi düşürür
    if (err instanceof PostmanApiError && err.kind === 'auth') throw err;
    return { label, error: errorMessage(err) };
  }
}

function jobLabel(job: ImportJob, name: string | null): string {
  switch (job.kind) {
    case 'collection':
      return msg('postmanApi.labelCollection', { name: name ?? job.uid });
    case 'environment':
      return msg('postmanApi.labelEnvironment', { name: name ?? job.uid });
    case 'globals':
      return msg('postmanApi.labelGlobals', { id: job.workspaceId });
  }
}

function noteDuplicateGlobals(
  values: unknown[],
  label: string,
  seen: Map<string, string>,
  warnings: string[],
): void {
  for (const value of values as Array<{ key?: string }>) {
    const key = value?.key;
    if (!key) continue;
    const previous = seen.get(key);
    if (previous !== undefined && previous !== label) {
      warnings.push(msg('postmanApi.duplicateGlobal', { key, label }));
    }
    seen.set(key, label);
  }
}

