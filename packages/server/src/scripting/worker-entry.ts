import { randomUUID } from 'node:crypto';
import { type Lang, t } from '../i18n/messages.js';
import { runScriptInSandbox } from './sandbox.js';
import type {
  HostToWorkerMessage,
  ScriptHttpBridge,
  ScriptHttpRequest,
  ScriptHttpResponse,
  WorkerToHostMessage,
} from './protocol.js';


/**
 * Script worker'ının child process giriş noktası (host.ts tarafından fork edilir).
 * Ana süreçle yalnızca IPC mesajları üzerinden konuşur; DB, ağ ya da dosya sistemi
 * erişimi yoktur — bunlara ihtiyaç da duymaz, çünkü tüm girdi host tarafından
 * önceden çözülüp mesaj içinde gönderilir (TASARIM.md §5.1). rq.sendRequest de
 * burada ağa çıkmaz: istek `sendRequest` mesajıyla host'a iletilir, host undici ile
 * yapar ve `sendRequestResult` ile yanıtlar (worker bundle'ına undici girmez).
 */
interface PendingCall {
  runId: string;
  resolve: (response: ScriptHttpResponse) => void;
  reject: (error: Error) => void;
}

const pendingCalls = new Map<string, PendingCall>();
/** Çalıştırma kimliği → istek dili (bekleyen çağrı iptal mesajı için) */
const runLanguages = new Map<string, Lang>();

function send(message: WorkerToHostMessage): void {
  process.send?.(message);
}

const bridge: ScriptHttpBridge = {
  sendRequest(runId: string, request: ScriptHttpRequest, timeoutMs: number): Promise<ScriptHttpResponse> {
    return new Promise<ScriptHttpResponse>((resolve, reject) => {
      const callId = randomUUID();
      pendingCalls.set(callId, { runId, resolve, reject });
      send({ type: 'sendRequest', runId, callId, request, timeoutMs });
    });
  },
};

/** Çalıştırma bitti (ya da isolate dispose edildi): o çalıştırmanın bekleyen çağrıları askıda kalmasın */
function rejectPendingCalls(runId: string): void {
  for (const [callId, call] of pendingCalls) {
    if (call.runId !== runId) continue;
    pendingCalls.delete(callId);
    call.reject(new Error(t(runLanguages.get(runId) ?? 'tr', 'script.pendingCallCancelled')));
  }
}

process.on('message', (message: HostToWorkerMessage) => {
  if (message?.type === 'sendRequestResult') {
    const call = pendingCalls.get(message.callId);
    if (!call) return; // çalıştırma çoktan bitti, geç gelen yanıt
    pendingCalls.delete(message.callId);
    if (message.ok) call.resolve(message.response);
    else call.reject(new Error(message.error));
    return;
  }
  if (message?.type !== 'run') return;
  runLanguages.set(message.id, message.language);
  void runScriptInSandbox(message, bridge).then((result) => {
    rejectPendingCalls(message.id);
    runLanguages.delete(message.id);
    send(result);
  });
});

// Ana süreç kapanınca IPC kanalı kopar; yetim worker olarak yaşamaya devam etme
process.on('disconnect', () => process.exit(0));

send({ type: 'ready' });
