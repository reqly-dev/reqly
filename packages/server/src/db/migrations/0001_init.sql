CREATE TABLE workspaces (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE collections (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    pre_request_script   TEXT,
    post_response_script TEXT,
    auth_json     TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE folders (
    id             TEXT PRIMARY KEY,
    collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    parent_id      TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    description    TEXT,
    pre_request_script   TEXT,
    post_response_script TEXT,
    auth_json      TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE requests (
    id             TEXT PRIMARY KEY,
    collection_id  TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    folder_id      TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    description    TEXT,
    method         TEXT NOT NULL,
    url            TEXT NOT NULL,
    headers_json   TEXT NOT NULL DEFAULT '[]',
    params_json    TEXT NOT NULL DEFAULT '[]',
    body_json      TEXT,
    auth_json      TEXT,
    pre_request_script   TEXT,
    post_response_script TEXT,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE INDEX idx_folders_collection ON folders(collection_id, parent_id, sort_order);
CREATE INDEX idx_requests_tree      ON requests(collection_id, folder_id, sort_order);

CREATE TABLE environments (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE variables (
    id              TEXT PRIMARY KEY,
    environment_id  TEXT REFERENCES environments(id) ON DELETE CASCADE,
    collection_id   TEXT REFERENCES collections(id)  ON DELETE CASCADE,
    workspace_id    TEXT REFERENCES workspaces(id)   ON DELETE CASCADE,
    key             TEXT NOT NULL,
    value           TEXT,
    is_secret       INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    CHECK (
        (environment_id IS NOT NULL) + (collection_id IS NOT NULL) + (workspace_id IS NOT NULL) = 1
    )
);

CREATE UNIQUE INDEX uq_var_env  ON variables(environment_id, key) WHERE environment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_var_coll ON variables(collection_id,  key) WHERE collection_id  IS NOT NULL;
CREATE UNIQUE INDEX uq_var_ws   ON variables(workspace_id,   key) WHERE workspace_id   IS NOT NULL;

CREATE TABLE history (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    request_id     TEXT,
    executed_at    INTEGER NOT NULL,
    duration_ms    INTEGER,
    method         TEXT NOT NULL,
    url            TEXT NOT NULL,
    request_headers_json TEXT,
    request_body   TEXT,
    status_code    INTEGER,
    response_headers_json TEXT,
    response_body  BLOB,
    response_size  INTEGER,
    truncated      INTEGER NOT NULL DEFAULT 0,
    error          TEXT
);

CREATE INDEX idx_history_time ON history(workspace_id, executed_at DESC);

CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
