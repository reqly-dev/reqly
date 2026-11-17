import type { AuthConfig, CollectionModel, FolderModel } from '@reqly/shared';
import { getFolder } from '../db/repositories/folders.js';

/**
 * Yapraktan köke doğru klasör zinciri. Auth inheritance (istek → klasör → koleksiyon)
 * ve script zinciri sıralaması (koleksiyon → klasör(ler) → istek, root'tan yaprağa
 * için ters çevrilir) bu tek kaynağı paylaşır.
 */
export function getFolderChainLeafToRoot(folderId: string | null | undefined): FolderModel[] {
  const chain: FolderModel[] = [];
  let current = folderId;
  while (current) {
    const folder = getFolder(current);
    if (!folder) break;
    chain.push(folder);
    current = folder.parentId;
  }
  return chain;
}

/**
 * Auth inheritance (TASARIM.md §4.1): istek → klasör zinciri → koleksiyon.
 * Kayıtlı bir isteğe bağlı değilse zincir boştur, yalnızca koleksiyon auth'una bakılır.
 */
export function resolveEffectiveAuth(
  own: AuthConfig | null,
  folderChainLeafToRoot: FolderModel[],
  collection: CollectionModel | null | undefined,
): AuthConfig | null {
  if (own) return own;
  for (const folder of folderChainLeafToRoot) {
    if (folder.auth) return folder.auth;
  }
  return collection?.auth ?? null;
}
