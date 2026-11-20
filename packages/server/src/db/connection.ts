import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { defaultDataDir } from '../paths.js';
import { runMigrations } from './migrate.js';

export function resolveDataDir(): string {
  return process.env.REQSTER_DATA_DIR ?? defaultDataDir;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dataDir = resolveDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'reqster.db');
  adoptLegacyDbFile(dataDir, dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Uygulamanın eski adı Reqly iken veri `reqly.db` dosyasındaydı. Yeni dosya yoksa eskisi (WAL/SHM eşleriyle)
 * yeniden adlandırılır; ana dosya en son taşınır ki yarıda kalan bir taşıma bir sonraki açılışta tamamlansın.
 */
function adoptLegacyDbFile(dataDir: string, dbPath: string): void {
  const legacy = path.join(dataDir, 'reqly.db');
  if (existsSync(dbPath) || !existsSync(legacy)) return;
  for (const suffix of ['-wal', '-shm', '']) {
    if (existsSync(legacy + suffix)) renameSync(legacy + suffix, dbPath + suffix);
  }
  console.log(`Veri dosyası yeni ada taşındı: ${legacy} → ${dbPath}`);
}

export function closeDb(): void {
  db?.close();
  db = null;
}
