import type { ExecuteTimings, HistoryDetail, HistorySummary } from '@reqster/shared';
import { getDb } from '../connection.js';
import { newId } from '../ids.js';

interface SummaryRow {
  id: string;
  request_id: string | null;
  executed_at: number;
  duration_ms: number | null;
  method: string;
  url: string;
  status_code: number | null;
  response_size: number | null;
  error: string | null;
}

interface DetailRow extends SummaryRow {
  request_headers_json: string | null;
  request_body: string | null;
  response_headers_json: string | null;
  response_body: Buffer | string | null;
  truncated: number;
  timings_json: string | null;
}

function toSummary(r: SummaryRow): HistorySummary {
  return {
    id: r.id,
    requestId: r.request_id,
    executedAt: r.executed_at,
    durationMs: r.duration_ms,
    method: r.method,
    url: r.url,
    statusCode: r.status_code,
    responseSize: r.response_size,
    error: r.error,
  };
}

export interface InsertHistoryInput {
  workspaceId: string;
  requestId: string | null;
  executedAt: number;
  durationMs: number | null;
  method: string;
  url: string;
  requestHeaders: Array<[string, string]>;
  requestBody: string | null;
  statusCode: number | null;
  responseHeaders: Array<[string, string]>;
  responseBody: string | null;
  responseSize: number | null;
  truncated: boolean;
  error: string | null;
  timings: ExecuteTimings | null;
}

export function insertHistory(input: InsertHistoryInput): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO history
         (id, workspace_id, request_id, executed_at, duration_ms, method, url,
          request_headers_json, request_body, status_code, response_headers_json,
          response_body, response_size, truncated, error, timings_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.workspaceId,
      input.requestId,
      input.executedAt,
      input.durationMs,
      input.method,
      input.url,
      JSON.stringify(input.requestHeaders),
      input.requestBody,
      input.statusCode,
      JSON.stringify(input.responseHeaders),
      input.responseBody,
      input.responseSize,
      input.truncated ? 1 : 0,
      input.error,
      input.timings ? JSON.stringify(input.timings) : null,
    );
  return id;
}

export function listHistory(workspaceId: string, limit = 100): HistorySummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, request_id, executed_at, duration_ms, method, url, status_code, response_size, error
       FROM history WHERE workspace_id = ? ORDER BY executed_at DESC LIMIT ?`,
    )
    .all(workspaceId, limit) as SummaryRow[];
  return rows.map(toSummary);
}

export function getHistoryDetail(id: string): HistoryDetail | null {
  const r = getDb().prepare('SELECT * FROM history WHERE id = ?').get(id) as DetailRow | undefined;
  if (!r) return null;
  const body =
    r.response_body == null
      ? null
      : Buffer.isBuffer(r.response_body)
        ? r.response_body.toString('utf8')
        : String(r.response_body);
  return {
    ...toSummary(r),
    requestHeaders: r.request_headers_json ? JSON.parse(r.request_headers_json) : [],
    requestBody: r.request_body,
    responseHeaders: r.response_headers_json ? JSON.parse(r.response_headers_json) : [],
    responseBody: body,
    truncated: r.truncated === 1,
    timings: r.timings_json ? (JSON.parse(r.timings_json) as ExecuteTimings) : null,
  };
}

export function clearHistory(workspaceId: string): void {
  getDb().prepare('DELETE FROM history WHERE workspace_id = ?').run(workspaceId);
}

/** Saklama politikası: workspace başına en fazla maxEntries kayıt tut */
export function pruneHistory(workspaceId: string, maxEntries: number): void {
  getDb()
    .prepare(
      `DELETE FROM history WHERE workspace_id = ? AND id NOT IN (
         SELECT id FROM history WHERE workspace_id = ? ORDER BY executed_at DESC LIMIT ?
       )`,
    )
    .run(workspaceId, workspaceId, maxEntries);
}
