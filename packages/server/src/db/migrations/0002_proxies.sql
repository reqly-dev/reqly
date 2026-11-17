-- Kayıtlı HTTP proxy profilleri. Uygulama geneli (workspace'e bağlı değil); en fazla biri aktiftir.
CREATE TABLE proxies (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    username     TEXT,
    password     TEXT,
    bypass_json  TEXT NOT NULL DEFAULT '[]',
    is_active    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- Aynı anda yalnızca bir proxy aktif olabilir
CREATE UNIQUE INDEX idx_proxies_single_active ON proxies(is_active) WHERE is_active = 1;
