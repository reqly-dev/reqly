/** Host (ana süreç) ile script worker (child process) arasındaki IPC mesaj sözleşmesi. */
import type { KeyValueItem, RequestBody } from '@reqly/shared';
import type { Lang } from '../i18n/messages.js';

export type ScriptPhase = 'pre-request' | 'post-response';

/** rq.request için gönderilen istek anlık görüntüsü (pre-request'te mutasyona açık) */
export interface ScriptRequestSnapshot {
  method: string;
  url: string;
  headers: KeyValueItem[];
  params: KeyValueItem[];
  body: RequestBody | null;
}

/** rq.response için gönderilen yanıt anlık görüntüsü (yalnızca post-response, salt-okunur) */
export interface ScriptResponseSnapshot {
  status: number | null;
  headers: Array<[string, string]>;
  body: string;
  durationMs: number;
}

interface ScopedVariable {
  value: string;
  isSecret: boolean;
}

/** Script'in başında kapsam bazlı okuma için verilen düz değişken haritaları */
export interface VariableSnapshot {
  environment: Record<string, ScopedVariable>;
  collection: Record<string, ScopedVariable>;
  global: Record<string, ScopedVariable>;
}

export type VariableScopeName = 'environment' | 'collection' | 'global';

export interface VariableMutation {
  scope: VariableScopeName;
  key: string;
  action: 'set' | 'unset';
  value?: string;
}

export interface ScriptLogEntryInternal {
  level: 'log' | 'warn' | 'error';
  message: string;
}

export interface ScriptTestResultInternal {
  name: string;
  passed: boolean;
  error?: string;
}

export interface RunScriptRequest {
  id: string;
  script: string;
  phase: ScriptPhase;
  timeoutMs: number;
  memoryLimitMb: number;
  consoleMaxBytes: number;
  variables: VariableSnapshot;
  request: ScriptRequestSnapshot;
  /** yalnızca phase='post-response' için dolu */
  response?: ScriptResponseSnapshot;
  /** Aktif ortamın adı (`pm.environment.name`); ortam yoksa undefined */
  environmentName?: string;
  /** `pm.info.requestName` — kayıtsız (geçici) istekte boş string */
  requestName: string;
  /** `pm.info.requestId` — kayıtsız istekte undefined */
  requestId?: string;
  /** Kullanıcıya görünen sandbox/worker mesajlarının dili (istek başlığından; worker'da bağlam yok) */
  language: Lang;
}

export type RunScriptMessage = { type: 'run' } & RunScriptRequest;

// ---- rq.sendRequest köprüsü (script içinden HTTP isteği) ----
// Akış: isolate → (ivm.Reference + applySyncPromise) → worker → IPC → host (undici) → IPC → worker → isolate.
// Ne isolate ne worker ağa çıkar; isteği yalnızca host yapar. Yanıt isolate'a JSON string olarak girer.

/** Script başına en çok kaç rq.sendRequest çağrısı yapılabilir */
export const SCRIPT_SEND_REQUEST_MAX = 10;
/** rq.sendRequest yanıt gövdesi bu boyutta kırpılır (1 MB) */
export const SCRIPT_HTTP_MAX_BODY_BYTES = 1_048_576;
/** setTimeout kuyruğunun üst sınırı (isolate'ta gerçek zamanlayıcı yok; bkz. prelude.ts) */
export const SCRIPT_TIMER_QUEUE_MAX = 100;

/** Isolate'ta {{var}} çözümü ve normalizasyon bittikten sonra worker'a/host'a giden istek */
export interface ScriptHttpRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: string | null;
}

export interface ScriptHttpResponse {
  status: number;
  headers: Array<[string, string]>;
  body: string;
  /** Gövde SCRIPT_HTTP_MAX_BODY_BYTES sınırında kırpıldıysa true */
  truncated: boolean;
  durationMs: number;
}

/** worker → host: script bir HTTP isteği istiyor; timeoutMs = min(kalan script süresi) — host ayrıca network.timeout_ms ile sınırlar */
export interface SendRequestMessage {
  type: 'sendRequest';
  runId: string;
  callId: string;
  request: ScriptHttpRequest;
  timeoutMs: number;
}

/** host → worker: isteğin sonucu */
export type SendRequestResultMessage = { type: 'sendRequestResult'; callId: string } & (
  | { ok: true; response: ScriptHttpResponse }
  | { ok: false; error: string }
);

export type HostToWorkerMessage = RunScriptMessage | SendRequestResultMessage;
export type WorkerToHostMessage = RunScriptResponse | SendRequestMessage | { type: 'ready' };

/** Worker'ın sandbox'a verdiği köprü: isteği host'a iletir, yanıtı bekler */
export interface ScriptHttpBridge {
  sendRequest(runId: string, request: ScriptHttpRequest, timeoutMs: number): Promise<ScriptHttpResponse>;
}

interface RunScriptResultBase {
  type: 'result';
  id: string;
  variableMutations: VariableMutation[];
  logs: ScriptLogEntryInternal[];
  tests: ScriptTestResultInternal[];
}

export interface RunScriptOk extends RunScriptResultBase {
  ok: true;
  /** phase='pre-request' ise script'in mutasyona uğrattığı istek; değilse girdiyle aynı */
  mutatedRequest: ScriptRequestSnapshot;
}

export interface RunScriptFail extends RunScriptResultBase {
  ok: false;
  error: string;
}

export type RunScriptResponse = RunScriptOk | RunScriptFail;
