import type { EnvironmentModel } from '@reqly/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  workspace_id: string;
  name: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): EnvironmentModel {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listEnvironments(workspaceId: string): EnvironmentModel[] {
  const rows = getDb()
    .prepare('SELECT * FROM environments WHERE workspace_id = ? ORDER BY name COLLATE NOCASE')
    .all(workspaceId) as Row[];
  return rows.map(toModel);
}

export function getEnvironment(id: string): EnvironmentModel | null {
  const row = getDb().prepare('SELECT * FROM environments WHERE id = ?').get(id) as
    | Row
    | undefined;
  return row ? toModel(row) : null;
}

export function getActiveEnvironment(workspaceId: string): EnvironmentModel | null {
  const row = getDb()
    .prepare('SELECT * FROM environments WHERE workspace_id = ? AND is_active = 1')
    .get(workspaceId) as Row | undefined;
  return row ? toModel(row) : null;
}

export function createEnvironment(workspaceId: string, name: string): EnvironmentModel {
  const now = Date.now();
  const id = newId();
  getDb()
    .prepare(
      'INSERT INTO environments (id, workspace_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .run(id, workspaceId, name, now, now);
  return getEnvironment(id)!;
}

export function renameEnvironment(id: string, name: string): EnvironmentModel | null {
  getDb()
    .prepare('UPDATE environments SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, Date.now(), id);
  return getEnvironment(id);
}

/** environmentId=null → hiçbir ortam aktif olmaz. Workspace başına en fazla 1 aktif garanti edilir. */
export function activateEnvironment(workspaceId: string, environmentId: string | null): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE environments SET is_active = 0 WHERE workspace_id = ?').run(workspaceId);
    if (environmentId) {
      db.prepare('UPDATE environments SET is_active = 1, updated_at = ? WHERE id = ?').run(
        Date.now(),
        environmentId,
      );
    }
  })();
}

export function deleteEnvironment(id: string): void {
  getDb().prepare('DELETE FROM environments WHERE id = ?').run(id);
}
