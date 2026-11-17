import { DEFAULT_SETTINGS, type SettingKey, type Settings, type SettingValue } from '@reqly/shared';
import { getDb } from '../connection.js';

export function getSetting<K extends SettingKey>(key: K): Settings[K] {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value) as Settings[K];
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export function setSetting(key: SettingKey, value: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, JSON.stringify(value));
}

/** DEFAULT_SETTINGS'teki her anahtarın efektif (DB'de varsa kayıtlı, yoksa varsayılan) değeri */
export function getAllSettings(): Settings {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    (out as Record<SettingKey, SettingValue>)[key] = getSetting(key);
  }
  return out;
}
