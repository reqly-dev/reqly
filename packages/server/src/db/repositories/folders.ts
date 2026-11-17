import type { AuthConfig, FolderModel } from '@reqly/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  collection_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  pre_request_script: string | null;
  post_response_script: string | null;
  auth_json: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): FolderModel {
  return {
    id: r.id,
    collectionId: r.collection_id,
    parentId: r.parent_id,
    name: r.name,
    description: r.description,
    preRequestScript: r.pre_request_script,
    postResponseScript: r.post_response_script,
    auth: r.auth_json ? (JSON.parse(r.auth_json) as AuthConfig) : null,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listFoldersByCollection(collectionId: string): FolderModel[] {
  const rows = getDb()
    .prepare('SELECT * FROM folders WHERE collection_id = ? ORDER BY sort_order, created_at')
    .all(collectionId) as Row[];
  return rows.map(toModel);
}

export function getFolder(id: string): FolderModel | null {
  const row = getDb().prepare('SELECT * FROM folders WHERE id = ?').get(id) as Row | undefined;
  return row ? toModel(row) : null;
}

export interface CreateFolderInput {
  collectionId: string;
  parentId?: string | null;
  name: string;
  description?: string | null;
  auth?: AuthConfig | null;
  preRequestScript?: string | null;
  postResponseScript?: string | null;
  sortOrder?: number;
}

export function createFolder(input: CreateFolderInput): FolderModel {
  const now = Date.now();
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO folders
         (id, collection_id, parent_id, name, description, pre_request_script, post_response_script, auth_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.collectionId,
      input.parentId ?? null,
      input.name,
      input.description ?? null,
      input.preRequestScript ?? null,
      input.postResponseScript ?? null,
      input.auth ? JSON.stringify(input.auth) : null,
      input.sortOrder ?? 0,
      now,
      now,
    );
  return getFolder(id)!;
}

export interface UpdateFolderInput {
  name?: string;
  description?: string | null;
  preRequestScript?: string | null;
  postResponseScript?: string | null;
  auth?: AuthConfig | null;
}

/** Yalnızca verilen alanları günceller (`undefined` = dokunma, `null` = temizle). */
export function updateFolder(id: string, patch: UpdateFolderInput): FolderModel | null {
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
  if (sets.length === 0) return getFolder(id);
  add('updated_at', Date.now());
  getDb()
    .prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values, id);
  return getFolder(id);
}

/** Verilen sırayı `sort_order` = sıra indeksi olarak yazar */
export function reorderFolders(ids: string[]): void {
  const stmt = getDb().prepare('UPDATE folders SET sort_order = ? WHERE id = ?');
  ids.forEach((id, i) => stmt.run(i, id));
}

/** Bir klasörün (ya da `parentId=null` ile koleksiyon kökünün) doğrudan alt klasörleri, ağaçtaki sırayla */
export function listChildFolders(collectionId: string, parentId: string | null): FolderModel[] {
  const rows = getDb()
    .prepare('SELECT * FROM folders WHERE collection_id = ? AND parent_id IS ? ORDER BY sort_order, created_at')
    .all(collectionId, parentId) as Row[];
  return rows.map(toModel);
}

export function deleteFolder(id: string): void {
  getDb().prepare('DELETE FROM folders WHERE id = ?').run(id);
}
