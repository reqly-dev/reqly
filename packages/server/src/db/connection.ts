import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defaultDataDir } from '../paths.js';
import { runMigrations } from './migrate.js';

export function resolveDataDir(): string {
  return process.env.REQLY_DATA_DIR ?? defaultDataDir;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'reqly.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
