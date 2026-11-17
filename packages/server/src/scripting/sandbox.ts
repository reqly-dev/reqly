import ivm from 'isolated-vm';
import { type Lang, t } from '../i18n/messages.js';
import { buildPmCompatSource } from './pm-compat.js';
import { buildPreludeSource } from './prelude.js';
import {
  SCRIPT_SEND_REQUEST_MAX,
  type RunScriptRequest,
  type RunScriptResponse,
  type ScriptHttpBridge,
  type ScriptHttpRequest,
  type ScriptLogEntryInternal,
  type ScriptRequestSnapshot,
  type ScriptTestResultInternal,
  type VariableMutation,
} from './protocol.js';

/**
 * `script.run`'ın zaman aşımı yalnızca isolate'ın JS koştuğu süreyi sayar; `applySyncPromise`
 * ile host yanıtı beklenen süre sayılmaz (spike ile doğrulandı). rq.sendRequest beklemeleri
 * ayrıca deadline'a göre kesildiği için toplam süre normalde timeoutMs'i geçmez; buna rağmen
 * aşılırsa isolate bu kadar ek süre sonra dispose edilir (host.ts güvenlik ağından —
 * HOST_TIMEOUT_GRACE_MS — kısa olmalı ki worker öldürülmek yerine sağlıklı kalsın).
 */
const WALL_CLOCK_GRACE_MS = 1_500;

interface RunState {
  done: boolean;
  error?: string;
}

/**
 * Kullanıcı script'ini izole bir V8 isolate'ında çalıştırır (TASARIM.md §5.1):
 * ağ/dosya/require erişimi yok, zaman ve bellek sınırlı. Bu fonksiyon her zaman
 * ayrı bir child process içinde çağrılmalıdır (bkz. worker-entry.ts) — bir isolate
 * çökmesi/segfault'u yalnızca o child process'i etkiler, ana sunucuyu değil.
 *
 * `bridge`: rq.sendRequest için worker'ın host'a açtığı IPC köprüsü. Isolate'a bunun
 * yalnızca tek bir `ivm.Reference`'ı girer; istek/yanıt JSON string olarak geçer.
 */
export async function runScriptInSandbox(
  input: RunScriptRequest,
  bridge: ScriptHttpBridge,
): Promise<RunScriptResponse> {
  const isolate = new ivm.Isolate({ memoryLimit: input.memoryLimitMb });
  let logs: ScriptLogEntryInternal[] = [];
  let tests: ScriptTestResultInternal[] = [];
  let mutations: VariableMutation[] = [];
  let mutatedRequest: ScriptRequestSnapshot = input.request;
  let sendRequestRef: ivm.Reference | undefined;
  let wallClockTimer: NodeJS.Timeout | undefined;
  let disposedByDeadline = false;

  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  let sendRequestCount = 0;

  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set('global', jail.derefInto());
    await jail.set('__variables', input.variables, { copy: true });
    await jail.set('__request', input.request, { copy: true });
    await jail.set(
      '__meta',
      {
        environmentName: input.environmentName,
        requestName: input.requestName,
        requestId: input.requestId,
        language: input.language,
      },
      { copy: true },
    );
    if (input.response) {
      await jail.set('__response', input.response, { copy: true });
    }

    // Tek köprü: prelude bunu kapanışına alıp global'den siler. Argüman ve dönüş JSON string'tir.
    sendRequestRef = new ivm.Reference(async (rawRequest: string): Promise<string> => {
      if (++sendRequestCount > SCRIPT_SEND_REQUEST_MAX) {
        throw new Error(t(input.language, 'script.sendRequestLimit', { max: SCRIPT_SEND_REQUEST_MAX }));
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(t(input.language, 'script.sendRequestDeadline'));
      const request = parseBridgeRequest(rawRequest, input.language);
      const response = await bridge.sendRequest(input.id, request, remaining);
      return JSON.stringify(response);
    });
    await jail.set('__sendRequest', sendRequestRef);

    // Kullanıcı gövdesi async fonksiyona sarılır: top-level await ve `await rq.sendRequest(...)` çalışır;
    // sonra setTimeout kuyruğu boşaltılır. Mikro görevler script.run bitmeden koşar (spike ile doğrulandı),
    // bu yüzden __runState run bittiğinde kesinleşmiş olur.
    const source = [
      buildPreludeSource(input.phase),
      buildPmCompatSource(input.phase),
      '(async function () {\n' + input.script + '\n})()',
      '  .then(function () { return globalThis.__drainTimers(); })',
      '  .then(function () { globalThis.__runState.done = true; },',
      '        function (e) { globalThis.__runState.done = true; globalThis.__runState.error = (e && e.message !== undefined) ? String(e.message) : String(e); });',
    ].join('\n');

    const script = await isolate.compileScript(source);

    wallClockTimer = setTimeout(() => {
      if (isolate.isDisposed) return;
      disposedByDeadline = true;
      isolate.dispose();
    }, input.timeoutMs + WALL_CLOCK_GRACE_MS);

    let runError: unknown;
    try {
      await script.run(context, { timeout: input.timeoutMs });
    } catch (err) {
      runError = err;
    }
    clearTimeout(wallClockTimer);

    if (disposedByDeadline) {
      return fail(t(input.language, 'script.wallClockTimeout', { ms: input.timeoutMs }));
    }

    // Hata (timeout dahil) olsa da isolate'in global durumu hâlâ okunabilir;
    // o ana kadar toplanan log/test/mutasyonları kaybetmemek için geri okunur.
    logs = truncateLogs(
      (await safeCopy<ScriptLogEntryInternal[]>(context, '__logs')) ?? [],
      input.consoleMaxBytes,
      input.language,
    );
    tests = (await safeCopy<ScriptTestResultInternal[]>(context, '__testResults')) ?? [];
    mutations = (await safeCopy<VariableMutation[]>(context, '__variableMutations')) ?? [];
    if (input.phase === 'pre-request') {
      mutatedRequest = (await safeCopy<ScriptRequestSnapshot>(context, '__request')) ?? input.request;
    }

    if (runError) {
      return fail(runError instanceof Error ? runError.message : String(runError));
    }

    const state = await safeCopy<RunState>(context, '__runState');
    if (state?.error !== undefined) return fail(state.error);
    if (!state?.done) {
      logs.push({ level: 'warn', message: t(input.language, 'script.unresolvedPromise') });
    }

    return {
      type: 'result',
      id: input.id,
      ok: true,
      mutatedRequest,
      variableMutations: mutations,
      logs,
      tests,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    if (wallClockTimer) clearTimeout(wallClockTimer);
    sendRequestRef?.release();
    if (!isolate.isDisposed) isolate.dispose();
  }

  function fail(error: string): RunScriptResponse {
    return { type: 'result', id: input.id, ok: false, error, logs, tests, variableMutations: mutations };
  }
}

/** Isolate'tan gelen JSON'u güvenmeden doğrular (prelude normalize eder ama kullanıcı kodu da aynı isolate'tadır) */
function parseBridgeRequest(raw: string, lang: Lang): ScriptHttpRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t(lang, 'script.bridgeParseFailed'));
  }
  const r = parsed as Partial<ScriptHttpRequest> | null;
  if (
    !r ||
    typeof r.url !== 'string' ||
    typeof r.method !== 'string' ||
    !Array.isArray(r.headers) ||
    !r.headers.every((h) => Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string') ||
    !(r.body === null || typeof r.body === 'string')
  ) {
    throw new Error(t(lang, 'script.bridgeInvalidShape'));
  }
  return { url: r.url, method: r.method, headers: r.headers as Array<[string, string]>, body: r.body };
}

async function safeCopy<T>(context: ivm.Context, key: string): Promise<T | undefined> {
  try {
    return (await context.global.get(key, { copy: true })) as T;
  } catch {
    return undefined;
  }
}

function truncateLogs(logs: ScriptLogEntryInternal[], maxBytes: number, lang: Lang): ScriptLogEntryInternal[] {
  let total = 0;
  const out: ScriptLogEntryInternal[] = [];
  for (const entry of logs) {
    total += Buffer.byteLength(entry.message, 'utf8');
    if (total > maxBytes) {
      out.push({ level: 'warn', message: t(lang, 'script.consoleTruncated') });
      break;
    }
    out.push(entry);
  }
  return out;
}
