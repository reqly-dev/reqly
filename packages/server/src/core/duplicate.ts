import type { CollectionModel, EnvironmentModel, FolderModel, RequestModel } from '@reqly/shared';
import { getDb } from '../db/connection.js';
import { createCollection, getCollection, listCollections } from '../db/repositories/collections.js';
import { createEnvironment, getEnvironment, listEnvironments } from '../db/repositories/environments.js';
import { createFolder, getFolder, listChildFolders, reorderFolders } from '../db/repositories/folders.js';
import { createRequest, getRequest, listRequestsInFolder, reorderRequests } from '../db/repositories/requests.js';
import { listVariables, upsertVariable } from '../db/repositories/variables.js';
import { msg } from '../i18n/context.js';

/**
 * Çoğaltma. Her işlem tek transaction'dır: yarıda kalan kopya bırakmaz. Kopya adı
 * "Ad (kopya)", aynı düzeyde çakışırsa "Ad (kopya 2)"... İstek ve klasör kopyası aslının hemen altına
 * yerleşir (kardeşlerin `sort_order`'ı yeniden yazılır); koleksiyon ve ortam ada göre sıralı listelenir.
 * Kopya her şeyi taşır: auth, script'ler, değişkenler (secret değer + işaret, enabled). History kopyalanmaz.
 */

export function duplicateRequest(id: string): RequestModel | null {
  const src = getRequest(id);
  if (!src) return null;
  return tx(() => {
    const siblings = listRequestsInFolder(src.collectionId, src.folderId);
    const copy = copyRequest(src, src.collectionId, src.folderId, copyName(src.name, siblings.map((r) => r.name)));
    reorderRequests(insertAfter(siblings.map((r) => r.id), src.id, copy.id));
    return getRequest(copy.id)!;
  });
}

export function duplicateFolder(id: string): FolderModel | null {
  const src = getFolder(id);
  if (!src) return null;
  return tx(() => {
    const siblings = listChildFolders(src.collectionId, src.parentId);
    const copy = copyFolderTree(src, src.collectionId, src.parentId, copyName(src.name, siblings.map((f) => f.name)));
    reorderFolders(insertAfter(siblings.map((f) => f.id), src.id, copy.id));
    return getFolder(copy.id)!;
  });
}

export function duplicateCollection(id: string): CollectionModel | null {
  const src = getCollection(id);
  if (!src) return null;
  return tx(() => {
    const copy = createCollection({
      workspaceId: src.workspaceId,
      name: copyName(src.name, listCollections(src.workspaceId).map((c) => c.name)),
      description: src.description,
      auth: src.auth,
      preRequestScript: src.preRequestScript,
      postResponseScript: src.postResponseScript,
    });
    copyVariables('collection', src.id, copy.id);
    copyLevel(src.id, null, copy.id, null);
    return copy;
  });
}

export function duplicateEnvironment(id: string): EnvironmentModel | null {
  const src = getEnvironment(id);
  if (!src) return null;
  return tx(() => {
    // Kopya etkin yapılmaz: createEnvironment is_active=0 açar, seçili ortam değişmez
    const copy = createEnvironment(src.workspaceId, copyName(src.name, listEnvironments(src.workspaceId).map((e) => e.name)));
    copyVariables('environment', src.id, copy.id);
    return copy;
  });
}

/* ---------- yardımcılar ---------- */

function tx<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

/** Bir düzeyin (kaynak klasör/kök) isteklerini ve alt klasör ağaçlarını hedef düzeye aynı sırayla kopyalar */
function copyLevel(srcCollectionId: string, srcFolderId: string | null, dstCollectionId: string, dstFolderId: string | null): void {
  for (const r of listRequestsInFolder(srcCollectionId, srcFolderId)) copyRequest(r, dstCollectionId, dstFolderId, r.name);
  for (const f of listChildFolders(srcCollectionId, srcFolderId)) copyFolderTree(f, dstCollectionId, dstFolderId, f.name);
}

function copyFolderTree(src: FolderModel, collectionId: string, parentId: string | null, name: string): FolderModel {
  const copy = createFolder({
    collectionId,
    parentId,
    name,
    description: src.description,
    auth: src.auth,
    preRequestScript: src.preRequestScript,
    postResponseScript: src.postResponseScript,
    sortOrder: src.sortOrder,
  });
  copyLevel(src.collectionId, src.id, collectionId, copy.id);
  return copy;
}

function copyRequest(src: RequestModel, collectionId: string, folderId: string | null, name: string): RequestModel {
  return createRequest({
    collectionId,
    folderId,
    name,
    description: src.description,
    method: src.method,
    url: src.url,
    headers: src.headers,
    params: src.params,
    body: src.body,
    auth: src.auth,
    preRequestScript: src.preRequestScript,
    postResponseScript: src.postResponseScript,
    sortOrder: src.sortOrder,
  });
}

function copyVariables(scope: 'environment' | 'collection', fromId: string, toId: string): void {
  for (const v of listVariables(scope, fromId)) {
    upsertVariable({ scope, ownerId: toId, key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled });
  }
}

/** "Ad (kopya)", varsa "Ad (kopya 2)", "Ad (kopya 3)"…; kopyanın kopyası "Ad (kopya) (kopya)" olmaz, kök ad kullanılır */
function copyName(name: string, taken: string[]): string {
  const suffix = msg('duplicate.suffix');
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = name.replace(new RegExp(` \\(${escaped}(?: \\d+)?\\)$`), '');
  const used = new Set(taken.map((t) => t.toLocaleLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `${base} (${suffix}${n === 1 ? '' : ` ${n}`})`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function insertAfter(ids: string[], afterId: string, newId: string): string[] {
  const rest = ids.filter((id) => id !== newId);
  const at = rest.indexOf(afterId);
  rest.splice(at + 1, 0, newId);
  return rest;
}
