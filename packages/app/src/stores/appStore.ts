import type {
  AuthConfig,
  CollectionModel,
  CollectionTree,
  CurlImportResult,
  EnvironmentModel,
  ExecuteInput,
  FolderModel,
  HierarchyPatch,
  ExecuteResult,
  HistoryDetail,
  HistorySummary,
  HttpMethod,
  ImportReport,
  KeyValueItem,
  ProxyPatch,
  ProxyProfile,
  ProxyUpsert,
  RequestBody,
  RequestModel,
} from '@reqly/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import { showBundleImportReport } from '../features/import/BundleImportReportDialog';
import { t } from '../lib/i18n';
import { summarizeImportReport } from '../lib/importReport';
import { dialog } from './dialogStore';

export interface Draft {
  requestId?: string;
  collectionId?: string;
  folderId: string | null;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueItem[];
  params: KeyValueItem[];
  body: RequestBody;
  auth: AuthConfig | null; // null = üstten devral
  preRequestScript: string;
  postResponseScript: string;
}

/** Kayıtsız isteğin yazılacağı yer ("Farklı kaydet" seçimi) */
export interface SaveTarget {
  collectionId: string;
  folderId: string | null;
  /** Verilirse isteğin (ve sekmenin) adı da bununla değişir */
  name?: string;
}

/** Draft'ın kaydedileceği yer belli değilse Kaydet önce hedef sormalıdır */
export function needsSaveTarget(draft: Draft): boolean {
  return !draft.requestId && !draft.collectionId;
}

export interface RequestTab {
  id: string;
  draft: Draft;
  dirty: boolean;
  response: ExecuteResult | null;
  executing: boolean;
}

function emptyDraft(collectionId?: string, folderId?: string | null): Draft {
  return {
    collectionId,
    folderId: folderId ?? null,
    name: t('request.newName'),
    method: 'GET',
    url: '',
    headers: [],
    params: [],
    body: { mode: 'none' },
    auth: null,
    preRequestScript: '',
    postResponseScript: '',
  };
}

function newTabState(draft: Draft): RequestTab {
  return { id: crypto.randomUUID(), draft, dirty: false, response: null, executing: false };
}

interface AppState {
  collections: CollectionTree[];
  environments: EnvironmentModel[];
  activeEnvironmentId: string | null;
  /** Kayıtlı proxy profilleri; en fazla biri `isActive` */
  proxies: ProxyProfile[];
  history: HistorySummary[];
  tabs: RequestTab[];
  activeTabId: string;
  notice: string | null;
  /** Tooltip önbelleğini geçersiz kılmak için; her değişken kaydında artar */
  variablesVersion: number;

  init: () => Promise<void>;
  refreshCollections: () => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  showNotice: (text: string) => void;
  bumpVariablesVersion: () => void;

  newTab: (collectionId?: string, folderId?: string | null) => void;
  openRequest: (request: RequestModel) => void;
  setActiveTab: (id: string) => void;
  /** Kaydedilmemiş sekmede onay sorar; kapatıldıysa true */
  closeTab: (id: string) => Promise<boolean>;
  updateDraft: (patch: Partial<Draft>) => void;
  /**
   * Ayrıştırılmış cURL'ü verilen sekmenin taslağına uygular (method/url/headers/params/body/auth);
   * ad, kayıt bağı ve script'ler korunur, sekme dirty olur. Sekme kapanmışsa bir şey yapmaz.
   */
  applyCurlToTab: (tabId: string, result: CurlImportResult) => void;
  /** Ayrıştırılmış cURL'ü yeni kayıtsız sekmede açar (aktif sekme dokunulmamış boş taslaksa onun yerine) */
  openCurlInNewTab: (result: CurlImportResult) => void;
  send: () => Promise<void>;
  /**
   * Aktif sekmeyi kaydeder: `target` verilirse `saveDraftAs` ile aynı (yeni kayıt);
   * yoksa kayıtlıysa PATCH, `collectionId`'si varsa POST. Hedef yoksa kaydetmez
   * (hedefi UI sorar, bkz. `needsSaveTarget`). Kaydedildiyse true.
   */
  saveDraft: (target?: SaveTarget) => Promise<boolean>;
  /** Aktif sekmeyi verilen yere YENİ istek olarak kaydeder; sekme yeni kayda bağlanır */
  saveDraftAs: (target: SaveTarget) => Promise<boolean>;

  createCollection: (name: string) => Promise<CollectionModel>;
  /** Koleksiyon ayarlarını kısmi günceller (verilmeyen alan değişmez); hata fırlatır */
  updateCollection: (id: string, patch: HierarchyPatch) => Promise<CollectionModel>;
  deleteCollection: (id: string) => Promise<void>;
  createFolder: (collectionId: string, parentId: string | null, name: string) => Promise<void>;
  /** Klasör ayarlarını kısmi günceller (verilmeyen alan değişmez); hata fırlatır */
  updateFolder: (id: string, patch: HierarchyPatch) => Promise<FolderModel>;
  deleteFolder: (id: string) => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;
  /** Çoğaltma: kopya aslının altına düşer; istek kopyası yeni sekmede açılır */
  duplicateRequest: (id: string) => Promise<void>;
  duplicateFolder: (id: string) => Promise<void>;
  duplicateCollection: (id: string) => Promise<void>;
  duplicateEnvironment: (id: string) => Promise<EnvironmentModel>;

  createEnvironment: (name: string) => Promise<EnvironmentModel>;
  renameEnvironment: (id: string, name: string) => Promise<EnvironmentModel>;
  deleteEnvironment: (id: string) => Promise<void>;
  activateEnvironment: (id: string | null) => Promise<void>;

  refreshProxies: () => Promise<void>;
  /** `null` = proxy yok (istekler doğrudan gider) */
  activateProxy: (id: string | null) => Promise<void>;
  createProxy: (input: ProxyUpsert) => Promise<ProxyProfile>;
  /** Kısmi güncelleme; `password` verilmezse dokunulmaz, `''`/null temizler */
  updateProxy: (id: string, patch: ProxyPatch) => Promise<ProxyProfile>;
  deleteProxy: (id: string) => Promise<void>;

  openHistoryEntry: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  importPostmanFile: (text: string) => Promise<void>;
}

/** Draft → `POST/PATCH /requests` gövdesi (`requestUpsertSchema`) */
function toPayload(draft: Draft) {
  return {
    collectionId: draft.collectionId ?? '',
    folderId: draft.folderId,
    name: draft.name,
    method: draft.method,
    url: draft.url,
    headers: draft.headers,
    params: draft.params,
    body: draft.body.mode === 'none' ? null : draft.body,
    auth: draft.auth,
    preRequestScript: draft.preRequestScript || null,
    postResponseScript: draft.postResponseScript || null,
  };
}

/** Draft → `POST /execute` gövdesi; `/export/curl` da aynı alanları alır */
export function toExecuteInput(draft: Draft): ExecuteInput {
  return {
    requestId: draft.requestId,
    collectionId: draft.collectionId,
    folderId: draft.folderId,
    method: draft.method,
    url: draft.url,
    headers: draft.headers,
    params: draft.params,
    body: draft.body.mode === 'none' ? null : draft.body,
    auth: draft.auth,
    preRequestScript: draft.preRequestScript,
    postResponseScript: draft.postResponseScript,
  };
}

/** cURL içe aktarımının taslağa yazdığı alanlar */
function curlDraftPatch(result: CurlImportResult): Partial<Draft> {
  return {
    method: result.method,
    url: result.url,
    headers: result.headers,
    params: result.params,
    body: result.body ?? { mode: 'none' },
    auth: result.auth,
  };
}

/** Hiç dokunulmamış boş taslak: yeni açılan içerik yeni sekme yerine bunun yerine geçer */
function isPristine(tab: RequestTab): boolean {
  return !tab.dirty && !tab.draft.requestId && tab.draft.url === '';
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function selectActiveTab(s: AppState): RequestTab {
  return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0]!;
}

export const useAppStore = create<AppState>((set, get) => {
  /** Aktif sekmeyi yerinde günceller */
  const patchTab = (tabId: string, patch: Partial<RequestTab>) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) }));
  };

  /** Yeni oluşan kaydı sekmeye bağlar; bekleme sırasında yapılan düzenlemeler korunur */
  const bindSaved = (tabId: string, saved: RequestModel) => {
    const current = get().tabs.find((t) => t.id === tabId);
    if (!current) return;
    patchTab(tabId, {
      draft: {
        ...current.draft,
        requestId: saved.id,
        collectionId: saved.collectionId,
        folderId: saved.folderId,
        name: saved.name,
      },
    });
  };

  /** Yeni sekmeyi açar; aktif sekme dokunulmamış boş bir taslaksa onun yerine koyar */
  const placeTab = (tab: RequestTab) => {
    set((s) => {
      const active = selectActiveTab(s);
      const tabs = isPristine(active) ? s.tabs.map((t) => (t.id === active.id ? tab : t)) : [...s.tabs, tab];
      return { tabs, activeTabId: tab.id };
    });
  };

  const initialTab = newTabState(emptyDraft());

  return {
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    proxies: [],
    history: [],
    tabs: [initialTab],
    activeTabId: initialTab.id,
    notice: null,
    variablesVersion: 0,

    init: async () => {
      const ws = await api.get<{ activeEnvironmentId: string | null }>('/workspace');
      set({ activeEnvironmentId: ws.activeEnvironmentId });
      await Promise.all([
        get().refreshCollections(),
        get().refreshEnvironments(),
        get().refreshProxies(),
        get().refreshHistory(),
      ]);
    },

    refreshCollections: async () => {
      set({ collections: await api.get<CollectionTree[]>('/collections') });
    },

    refreshEnvironments: async () => {
      const environments = await api.get<EnvironmentModel[]>('/environments');
      set({ environments, activeEnvironmentId: environments.find((e) => e.isActive)?.id ?? null });
    },

    refreshHistory: async () => {
      set({ history: await api.get<HistorySummary[]>('/history?limit=100') });
    },

    showNotice: (text) => {
      if (noticeTimer) clearTimeout(noticeTimer);
      set({ notice: text });
      noticeTimer = setTimeout(() => set({ notice: null }), 5000);
    },

    bumpVariablesVersion: () => set((s) => ({ variablesVersion: s.variablesVersion + 1 })),

    newTab: (collectionId, folderId) => {
      const tab = newTabState(emptyDraft(collectionId, folderId));
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    },

    openRequest: (request) => {
      // Aynı istek zaten bir sekmede açıksa onu odakla (yeni sekme açma)
      const existing = get().tabs.find((t) => t.draft.requestId === request.id);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
      const draft: Draft = {
        requestId: request.id,
        collectionId: request.collectionId,
        folderId: request.folderId,
        name: request.name,
        method: request.method,
        url: request.url,
        headers: request.headers,
        params: request.params,
        body: request.body ?? { mode: 'none' },
        auth: request.auth,
        preRequestScript: request.preRequestScript ?? '',
        postResponseScript: request.postResponseScript ?? '',
      };
      placeTab(newTabState(draft));
    },

    setActiveTab: (id) => set({ activeTabId: id }),

    closeTab: async (id) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab) return false;
      if (tab.dirty) {
        const ok = await dialog.confirm({
          title: t('tabs.closeConfirm.title'),
          message: t('tabs.closeConfirm.message', { name: tab.draft.name }),
          confirmLabel: t('common.close'),
          danger: true,
        });
        if (!ok) return false;
      }
      // Onay beklerken sekme listesi değişmiş olabilir; güncel durumla hesapla
      const { tabs, activeTabId } = get();
      if (!tabs.some((t) => t.id === id)) return false;
      const index = tabs.findIndex((t) => t.id === id);
      let remaining = tabs.filter((t) => t.id !== id);
      if (remaining.length === 0) remaining = [newTabState(emptyDraft())];
      const nextActive =
        activeTabId === id
          ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0]!.id)
          : activeTabId;
      set({ tabs: remaining, activeTabId: nextActive });
      return true;
    },

    updateDraft: (patch) => {
      const active = selectActiveTab(get());
      patchTab(active.id, { draft: { ...active.draft, ...patch }, dirty: true });
    },

    applyCurlToTab: (tabId, result) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;
      patchTab(tabId, { draft: { ...tab.draft, ...curlDraftPatch(result) }, dirty: true });
    },

    openCurlInNewTab: (result) => {
      placeTab({ ...newTabState({ ...emptyDraft(), ...curlDraftPatch(result) }), dirty: true });
    },

    send: async () => {
      const tab = selectActiveTab(get());
      const { draft } = tab;
      if (!draft.url.trim()) {
        get().showNotice(t('notice.urlRequired'));
        return;
      }
      patchTab(tab.id, { executing: true });
      try {
        const result = await api.post<ExecuteResult>('/execute', toExecuteInput(draft));
        patchTab(tab.id, { response: result });
        if (result.unresolvedVariables.length > 0) {
          get().showNotice(t('notice.unresolvedVariables', { list: result.unresolvedVariables.join(', ') }));
        }
      } catch (err) {
        get().showNotice(err instanceof Error ? err.message : String(err));
      } finally {
        patchTab(tab.id, { executing: false });
        void get().refreshHistory();
      }
    },

    saveDraft: async (target) => {
      if (target) return get().saveDraftAs(target);
      const tab = selectActiveTab(get());
      const { draft } = tab;
      if (!draft.requestId && !draft.collectionId) return false;
      try {
        if (draft.requestId) {
          await api.patch<RequestModel>(`/requests/${draft.requestId}`, toPayload(draft));
        } else {
          const saved = await api.post<RequestModel>('/requests', toPayload(draft));
          bindSaved(tab.id, saved);
        }
        patchTab(tab.id, { dirty: false });
        get().showNotice(t('notice.requestSaved'));
        await get().refreshCollections();
        return true;
      } catch (err) {
        get().showNotice(err instanceof Error ? err.message : String(err));
        return false;
      }
    },

    saveDraftAs: async (target) => {
      const tab = selectActiveTab(get());
      const draft: Draft = {
        ...tab.draft,
        collectionId: target.collectionId,
        folderId: target.folderId,
        name: target.name ?? tab.draft.name,
      };
      try {
        const saved = await api.post<RequestModel>('/requests', toPayload(draft));
        bindSaved(tab.id, saved);
        patchTab(tab.id, { dirty: false });
        get().showNotice(t('notice.requestSaved'));
        await get().refreshCollections();
        return true;
      } catch (err) {
        get().showNotice(err instanceof Error ? err.message : String(err));
        return false;
      }
    },

    createCollection: async (name) => {
      const collection = await api.post<CollectionModel>('/collections', { name });
      await get().refreshCollections();
      return collection;
    },

    updateCollection: async (id, patch) => {
      const collection = await api.patch<CollectionModel>(`/collections/${id}`, patch);
      await get().refreshCollections();
      return collection;
    },

    deleteCollection: async (id) => {
      await api.delete(`/collections/${id}`);
      // Silinen koleksiyona ait sekmelerin kayıt bağlantısı kalktı; taslak olarak yaşasınlar
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.draft.collectionId === id
            ? { ...t, draft: { ...t.draft, requestId: undefined, collectionId: undefined } }
            : t,
        ),
      }));
      await get().refreshCollections();
    },

    createFolder: async (collectionId, parentId, name) => {
      await api.post('/folders', { collectionId, parentId, name });
      await get().refreshCollections();
    },

    updateFolder: async (id, patch) => {
      const folder = await api.patch<FolderModel>(`/folders/${id}`, patch);
      await get().refreshCollections();
      return folder;
    },

    deleteFolder: async (id) => {
      await api.delete(`/folders/${id}`);
      await get().refreshCollections();
    },

    deleteRequest: async (id) => {
      await api.delete(`/requests/${id}`);
      const openTab = get().tabs.find((t) => t.draft.requestId === id);
      if (openTab) {
        // Sekme açık kalsın ama artık kayda bağlı olmasın
        patchTab(openTab.id, { draft: { ...openTab.draft, requestId: undefined }, dirty: true });
      }
      await get().refreshCollections();
    },

    duplicateRequest: async (id) => {
      const copy = await api.post<RequestModel>(`/requests/${id}/duplicate`);
      await get().refreshCollections();
      get().openRequest(copy);
    },

    duplicateFolder: async (id) => {
      await api.post(`/folders/${id}/duplicate`);
      await get().refreshCollections();
    },

    duplicateCollection: async (id) => {
      await api.post(`/collections/${id}/duplicate`);
      await get().refreshCollections();
    },

    duplicateEnvironment: async (id) => {
      const copy = await api.post<EnvironmentModel>(`/environments/${id}/duplicate`);
      await get().refreshEnvironments();
      // Kopya etkin değil ama değişken listeleri/vurgular tutarlı kalsın
      get().bumpVariablesVersion();
      return copy;
    },

    createEnvironment: async (name) => {
      const environment = await api.post<EnvironmentModel>('/environments', { name });
      await get().refreshEnvironments();
      return environment;
    },

    renameEnvironment: async (id, name) => {
      const environment = await api.patch<EnvironmentModel>(`/environments/${id}`, { name });
      await get().refreshEnvironments();
      return environment;
    },

    deleteEnvironment: async (id) => {
      await api.delete(`/environments/${id}`);
      await get().refreshEnvironments();
      get().bumpVariablesVersion();
    },

    activateEnvironment: async (id) => {
      await api.post('/environments/activate', { environmentId: id });
      await get().refreshEnvironments();
      get().bumpVariablesVersion();
    },

    refreshProxies: async () => {
      set({ proxies: await api.get<ProxyProfile[]>('/proxies') });
    },

    activateProxy: async (id) => {
      set({ proxies: await api.put<ProxyProfile[]>('/proxies/active', { id }) });
    },

    createProxy: async (input) => {
      const proxy = await api.post<ProxyProfile>('/proxies', input);
      await get().refreshProxies();
      return proxy;
    },

    updateProxy: async (id, patch) => {
      const proxy = await api.patch<ProxyProfile>(`/proxies/${id}`, patch);
      await get().refreshProxies();
      return proxy;
    },

    deleteProxy: async (id) => {
      await api.delete(`/proxies/${id}`);
      await get().refreshProxies();
    },

    openHistoryEntry: async (id) => {
      const detail = await api.get<HistoryDetail>(`/history/${id}`);
      const tab = selectActiveTab(get());
      patchTab(tab.id, {
        response: {
          historyId: detail.id,
          status: detail.statusCode ?? undefined,
          statusText: detail.statusCode != null ? String(detail.statusCode) : undefined,
          headers: detail.responseHeaders,
          body: detail.responseBody ?? '',
          sizeBytes: detail.responseSize ?? 0,
          durationMs: detail.durationMs ?? 0,
          truncated: detail.truncated,
          error: detail.error ?? undefined,
          resolvedUrl: detail.url,
          unresolvedVariables: [],
          scriptLogs: [],
          testResults: [],
          timings: detail.timings ?? undefined,
        },
      });
    },

    clearHistory: async () => {
      await api.delete('/history');
      await get().refreshHistory();
    },

    importPostmanFile: async (text) => {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        get().showNotice(t('notice.invalidJsonFile'));
        return;
      }
      const obj = json as { item?: unknown; values?: unknown; name?: unknown; format?: unknown };
      // Reqly paylaşım paketi: koleksiyon + ortam + globals tek dosyada, atomik yüklenir
      const isBundle = obj.format === 'reqly-bundle';
      const isEnvironment = !isBundle && Array.isArray(obj.values) && obj.item === undefined;
      try {
        const report = await api.post<ImportReport>(
          isBundle ? '/import/bundle' : isEnvironment ? '/import/postman-environment' : '/import/postman',
          json,
        );
        if (isBundle && report.warnings.length > 0) {
          // Paket secret değerleri boş taşır; kullanıcı hangi anahtarları doldurması gerektiğini görsün
          showBundleImportReport(report);
        } else {
          get().showNotice(summarizeImportReport(report));
        }
        get().bumpVariablesVersion();
        await Promise.all([get().refreshCollections(), get().refreshEnvironments()]);
      } catch (err) {
        get().showNotice(t('notice.importFailed', { error: err instanceof Error ? err.message : String(err) }));
      }
    },
  };
});
