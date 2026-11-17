import type { VariableModel, VariableScope } from '@reqly/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  environment_id: string | null;
  collection_id: string | null;
  workspace_id: string | null;
  key: string;
  value: string | null;
  is_secret: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function toModel(r: Row): VariableModel {
  const scope: VariableScope = r.environment_id
    ? 'environment'
    : r.collection_id
      ? 'collection'
      : 'global';
  return {
    id: r.id,
    scope,
    ownerId: (r.environment_id ?? r.collection_id ?? r.workspace_id)!,
    key: r.key,
    value: r.value ?? '',
    isSecret: r.is_secret === 1,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SCOPE_COLUMN: Record<VariableScope, string> = {
  environment: 'environment_id',
  collection: 'collection_id',
  global: 'workspace_id',
};

export function listVariables(scope: VariableScope, ownerId: string): VariableModel[] {
  const rows = getDb()
    .prepare(`SELECT * FROM variables WHERE ${SCOPE_COLUMN[scope]} = ? ORDER BY key`)
    .all(ownerId) as Row[];
  return rows.map(toModel);
}

export function getVariable(id: string): VariableModel | null {
  const row = getDb().prepare('SELECT * FROM variables WHERE id = ?').get(id) as Row | undefined;
  return row ? toModel(row) : null;
}

export interface UpsertVariableInput {
  scope: VariableScope;
  ownerId: string;
  key: string;
  value: string;
  isSecret?: boolean;
  enabled?: boolean;
}

/**
 * Aynı kapsamda aynı anahtar varsa günceller, yoksa ekler.
 * `isSecret`/`enabled` verilmezse MEVCUT değer korunur — script'lerin
 * `rq.environment.set(key, value)` gibi değer-only çağrıları, halihazırda
 * secret işaretli bir değişkenin maskeleme bayrağını sessizce sıfırlamamalıdır.
 */
export function upsertVariable(input: UpsertVariableInput): VariableModel {
  const db = getDb();
  const col = SCOPE_COLUMN[input.scope];
  const now = Date.now();
  const existing = db
    .prepare(`SELECT * FROM variables WHERE ${col} = ? AND key = ?`)
    .get(input.ownerId, input.key) as Row | undefined;

  if (existing) {
    const isSecret = input.isSecret ?? existing.is_secret === 1;
    const enabled = input.enabled ?? existing.enabled === 1;
    db.prepare(
      'UPDATE variables SET value = ?, is_secret = ?, enabled = ?, updated_at = ? WHERE id = ?',
    ).run(input.value, isSecret ? 1 : 0, enabled ? 1 : 0, now, existing.id);
    return getVariable(existing.id)!;
  }

  const id = newId();
  db.prepare(
    `INSERT INTO variables (id, ${col}, key, value, is_secret, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ownerId,
    input.key,
    input.value,
    input.isSecret ? 1 : 0,
    input.enabled === false ? 0 : 1,
    now,
    now,
  );
  return getVariable(id)!;
}

export function deleteVariable(id: string): void {
  getDb().prepare('DELETE FROM variables WHERE id = ?').run(id);
}

/** Script'lerin rq.*.unset(key) çağrısı için: id bilinmeden scope+key ile silme */
export function deleteVariableByKey(scope: VariableScope, ownerId: string, key: string): void {
  const col = SCOPE_COLUMN[scope];
  getDb()
    .prepare(`DELETE FROM variables WHERE ${col} = ? AND key = ?`)
    .run(ownerId, key);
}

/** Değişken çözümleme için: enabled olanların key→{value,isSecret} haritası */
export function variableMap(
  scope: VariableScope,
  ownerId: string,
): Map<string, { value: string; isSecret: boolean }> {
  const map = new Map<string, { value: string; isSecret: boolean }>();
  for (const v of listVariables(scope, ownerId)) {
    if (v.enabled) map.set(v.key, { value: v.value, isSecret: v.isSecret });
  }
  return map;
}
