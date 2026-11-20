import type { WorkspaceModel } from '@reqster/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): WorkspaceModel {
  return { id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at };
}

/** Faz 1: tek workspace — yoksa oluşturur */
export function getDefaultWorkspace(): WorkspaceModel {
  const db = getDb();
  const row = db.prepare('SELECT * FROM workspaces ORDER BY created_at LIMIT 1').get() as
    | Row
    | undefined;
  if (row) return toModel(row);

  const now = Date.now();
  const ws: Row = { id: newId(), name: 'Workspace', created_at: now, updated_at: now };
  db.prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    ws.id,
    ws.name,
    ws.created_at,
    ws.updated_at,
  );
  return toModel(ws);
}
