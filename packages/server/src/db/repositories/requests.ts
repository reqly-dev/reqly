import type {
  AuthConfig,
  HttpMethod,
  KeyValueItem,
  RequestBody,
  RequestModel,
} from '@reqly/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  collection_id: string;
  folder_id: string | null;
  name: string;
  description: string | null;
  method: string;
  url: string;
  headers_json: string;
  params_json: string;
  body_json: string | null;
  auth_json: string | null;
  pre_request_script: string | null;
  post_response_script: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): RequestModel {
  return {
    id: r.id,
    collectionId: r.collection_id,
    folderId: r.folder_id,
    name: r.name,
    description: r.description,
    method: r.method as HttpMethod,
    url: r.url,
    headers: JSON.parse(r.headers_json) as KeyValueItem[],
    params: JSON.parse(r.params_json) as KeyValueItem[],
    body: r.body_json ? (JSON.parse(r.body_json) as RequestBody) : null,
    auth: r.auth_json ? (JSON.parse(r.auth_json) as AuthConfig) : null,
    preRequestScript: r.pre_request_script,
    postResponseScript: r.post_response_script,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listRequestsByCollection(collectionId: string): RequestModel[] {
  const rows = getDb()
    .prepare('SELECT * FROM requests WHERE collection_id = ? ORDER BY sort_order, created_at')
    .all(collectionId) as Row[];
  return rows.map(toModel);
}

export function getRequest(id: string): RequestModel | null {
  const row = getDb().prepare('SELECT * FROM requests WHERE id = ?').get(id) as Row | undefined;
  return row ? toModel(row) : null;
}

export interface UpsertRequestInput {
  collectionId: string;
  folderId?: string | null;
  name: string;
  description?: string | null;
  method: HttpMethod;
  url: string;
  headers?: KeyValueItem[];
  params?: KeyValueItem[];
  body?: RequestBody | null;
  auth?: AuthConfig | null;
  preRequestScript?: string | null;
  postResponseScript?: string | null;
  sortOrder?: number;
}

export function createRequest(input: UpsertRequestInput): RequestModel {
  const now = Date.now();
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO requests
         (id, collection_id, folder_id, name, description, method, url,
          headers_json, params_json, body_json, auth_json,
          pre_request_script, post_response_script, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.collectionId,
      input.folderId ?? null,
      input.name,
      input.description ?? null,
      input.method,
      input.url,
      JSON.stringify(input.headers ?? []),
      JSON.stringify(input.params ?? []),
      input.body ? JSON.stringify(input.body) : null,
      input.auth ? JSON.stringify(input.auth) : null,
      input.preRequestScript ?? null,
      input.postResponseScript ?? null,
      input.sortOrder ?? 0,
      now,
      now,
    );
  return getRequest(id)!;
}

export function updateRequest(id: string, input: UpsertRequestInput): RequestModel | null {
  const existing = getRequest(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE requests SET
         folder_id = ?, name = ?, description = ?, method = ?, url = ?,
         headers_json = ?, params_json = ?, body_json = ?, auth_json = ?,
         pre_request_script = ?, post_response_script = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.folderId ?? null,
      input.name,
      input.description ?? null,
      input.method,
      input.url,
      JSON.stringify(input.headers ?? []),
      JSON.stringify(input.params ?? []),
      input.body ? JSON.stringify(input.body) : null,
      input.auth ? JSON.stringify(input.auth) : null,
      // İstek script'leri de güncellenir (önceden eksikti: Kaydet script değişikliğini kalıcı yazmıyordu)
      input.preRequestScript ?? null,
      input.postResponseScript ?? null,
      Date.now(),
      id,
    );
  return getRequest(id);
}

/** Verilen sırayı `sort_order` = sıra indeksi olarak yazar (çoğaltılan öğeyi aslının hemen altına koymak için) */
export function reorderRequests(ids: string[]): void {
  const stmt = getDb().prepare('UPDATE requests SET sort_order = ? WHERE id = ?');
  ids.forEach((id, i) => stmt.run(i, id));
}

/** Bir klasörün (ya da `folderId=null` ile koleksiyon kökünün) doğrudan istekleri, ağaçtaki sırayla */
export function listRequestsInFolder(collectionId: string, folderId: string | null): RequestModel[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM requests WHERE collection_id = ? AND folder_id IS ? ORDER BY sort_order, created_at',
    )
    .all(collectionId, folderId) as Row[];
  return rows.map(toModel);
}

export function deleteRequest(id: string): void {
  getDb().prepare('DELETE FROM requests WHERE id = ?').run(id);
}
