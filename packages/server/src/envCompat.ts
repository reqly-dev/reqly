/**
 * Uygulamanın eski adı Reqly iken ortam değişkenleri `REQLY_*` idi (Docker kurulumları, taşınabilir mod
 * betikleri). Yeni karşılığı (`REQSTER_*`) verilmemişse eskisinin değeri kopyalanır, böylece kodun geri
 * kalanı yalnızca yeni adları okur. Yan etkili modüldür: sunucu girişinde İLK import olmalıdır, çünkü
 * bazı modüller (`paths.ts`) ortamı yüklenirken okur.
 */
const LEGACY_PREFIX = 'REQLY_';

for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith(LEGACY_PREFIX) || value === undefined) continue;
  const current = `REQSTER_${key.slice(LEGACY_PREFIX.length)}`;
  if (process.env[current] === undefined) process.env[current] = value;
}
