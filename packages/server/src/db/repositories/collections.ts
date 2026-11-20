import type { AuthConfig, CollectionModel } from '@reqster/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  pre_request_script: string | null;
  post_response_script: string | null;
  auth_json: string | null;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): CollectionModel {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description,
    preRequestScript: r.pre_request_script,
    postResponseScript: r.post_response_script,
    auth: r.auth_json ? (JSON.parse(r.auth_json) as AuthConfig) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listCollections(workspaceId: string): CollectionModel[] {
  const rows = getDb()
    .prepare('SELECT * FROM collections WHERE workspace_id = ? ORDER BY name COLLATE NOCASE')
    .all(workspaceId) as Row[];
  return rows.map(toModel);
}

export function getCollection(id: string): CollectionModel | null {
  const row = getDb().prepare('SELECT * FROM collections WHERE id = ?').get(id) as Row | undefined;
  return row ? toModel(row) : null;
}

export interface CreateCollectionInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  auth?: AuthConfig | null;
  preRequestScript?: string | null;
  postResponseScript?: string | null;
}

export function createCollection(input: CreateCollectionInput): CollectionModel {
  const now = Date.now();
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO collections
         (id, workspace_id, name, description, pre_request_script, post_response_script, auth_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.name,
      input.description ?? null,
      input.preRequestScript ?? null,
      input.postResponseScript ?? null,
      input.auth ? JSON.stringify(input.auth) : null,
      now,
      now,
    );
  return getCollection(id)!;
}

export interface UpdateCollectionInput {
  name?: string;
  description?: string | null;
  preRequestScript?: string | null;
  postResponseScript?: string | null;
  auth?: AuthConfig | null;
}

/** Yalnızca verilen alanları günceller (`undefined` = dokunma, `null` = temizle). */
export function updateCollection(id: string, patch: UpdateCollectionInput): CollectionModel | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.description !== undefined) add('description', patch.description);
  if (patch.preRequestScript !== undefined) add('pre_request_script', patch.preRequestScript);
  if (patch.postResponseScript !== undefined) add('post_response_script', patch.postResponseScript);
  if (patch.auth !== undefined) add('auth_json', patch.auth ? JSON.stringify(patch.auth) : null);
  if (sets.length === 0) return getCollection(id);
  add('updated_at', Date.now());
  getDb()
    .prepare(`UPDATE collections SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id);
  return getCollection(id);
}

export function deleteCollection(id: string): void {
  getDb().prepare('DELETE FROM collections WHERE id = ?').run(id);
}
