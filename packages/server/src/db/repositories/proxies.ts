import type { ProxyPatch, ProxyProfile, ProxyUpsert } from '@reqly/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface Row {
  id: string;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
  bypass_json: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

/**
 * Aktif proxy'nin bağlantı için gereken hali — parola dahil. `engine/dispatcher.ts` ve yalnızca
 * masaüstü kabuğuna hizmet eden `GET /api/internal/proxy-url` kullanır; kullanıcıya açık API'ye asla
 * dönmez (API tarafı `ProxyProfile`'dır, orada parola yerine `hasPassword` vardır).
 */
export interface ActiveProxy {
  id: string;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
  bypass: string[];
}

function parseBypass(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toProfile(r: Row): ProxyProfile {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    username: r.username,
    hasPassword: r.password != null && r.password !== '',
    bypass: parseBypass(r.bypass_json),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listProxies(): ProxyProfile[] {
  const rows = getDb().prepare('SELECT * FROM proxies ORDER BY name COLLATE NOCASE').all() as Row[];
  return rows.map(toProfile);
}

export function getProxy(id: string): ProxyProfile | null {
  const row = getDb().prepare('SELECT * FROM proxies WHERE id = ?').get(id) as Row | undefined;
  return row ? toProfile(row) : null;
}

export function getActiveProxy(): ActiveProxy | null {
  const row = getDb().prepare('SELECT * FROM proxies WHERE is_active = 1').get() as Row | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    username: row.username,
    password: row.password,
    bypass: parseBypass(row.bypass_json),
  };
}

/** Boş kullanıcı adı / parola `null` olarak saklanır */
function normalizeCredential(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : value;
}

export function createProxy(input: ProxyUpsert): ProxyProfile {
  const now = Date.now();
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO proxies (id, name, url, username, password, bypass_json, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.url,
      normalizeCredential(input.username),
      normalizeCredential(input.password),
      JSON.stringify(input.bypass),
      now,
      now,
    );
  return getProxy(id)!;
}

/**
 * Kısmi güncelleme: `undefined` alan dokunulmaz. `password` için `null` ya da `''` parolayı temizler.
 * Kayıt yoksa null döner.
 */
export function updateProxy(id: string, patch: ProxyPatch): ProxyProfile | null {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as Row | undefined;
  if (!existing) return null;

  db.prepare(
    `UPDATE proxies
        SET name = ?, url = ?, username = ?, password = ?, bypass_json = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.name ?? existing.name,
    patch.url ?? existing.url,
    patch.username === undefined ? existing.username : normalizeCredential(patch.username),
    patch.password === undefined ? existing.password : normalizeCredential(patch.password),
    patch.bypass === undefined ? existing.bypass_json : JSON.stringify(patch.bypass),
    Date.now(),
    id,
  );
  return getProxy(id);
}

/** Aktif proxy silinirse hiçbir proxy aktif kalmaz (satırla birlikte bayrak da gider) */
export function deleteProxy(id: string): void {
  getDb().prepare('DELETE FROM proxies WHERE id = ?').run(id);
}

/** id=null → hiçbir proxy aktif olmaz ("proxy yok"). Aynı anda en fazla 1 aktif garanti edilir. */
export function setActiveProxy(id: string | null): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE proxies SET is_active = 0 WHERE is_active = 1').run();
    if (id) {
      db.prepare('UPDATE proxies SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
    }
  })();
}
