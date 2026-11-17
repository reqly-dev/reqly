import { settingsPatchSchema, type AppVersionInfo, type SettingKey } from '@reqly/shared';
import type { FastifyInstance } from 'fastify';
import { getAllSettings, setSetting } from '../db/repositories/settings.js';
import { appVersion } from '../paths.js';
import { parseBody } from './helpers.js';

export function settingsRoutes(app: FastifyInstance): void {
  app.get('/settings', () => getAllSettings());

  // Ayarlar > Güncellemeler'de gösterilen yüklü sürüm (paketli modda build-info.json'dan)
  app.get('/version', (): AppVersionInfo => ({ version: appVersion() }));

  app.patch('/settings', (req, reply) => {
    const body = parseBody(settingsPatchSchema, req.body, reply);
    if (!body) return;
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) setSetting(key as SettingKey, value);
    }
    return getAllSettings();
  });
}
