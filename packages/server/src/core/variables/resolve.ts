import type { ResolvedVariable, VariableScope } from '@reqly/shared';
import { getActiveEnvironment } from '../../db/repositories/environments.js';
import { listVariables, variableMap } from '../../db/repositories/variables.js';

export interface VariableValue {
  value: string;
  isSecret: boolean;
}

export type VariableResolver = (key: string) => VariableValue | undefined;

/**
 * Çözümleme önceliği (TASARIM.md §4.2): ortam → koleksiyon → global.
 * Dönen resolver, interpolasyon motoruna verilir.
 */
export function buildResolver(workspaceId: string, collectionId?: string): VariableResolver {
  const activeEnv = getActiveEnvironment(workspaceId);
  const envVars = activeEnv
    ? variableMap('environment', activeEnv.id)
    : new Map<string, VariableValue>();
  const collVars = collectionId
    ? variableMap('collection', collectionId)
    : new Map<string, VariableValue>();
  const globalVars = variableMap('global', workspaceId);

  return (key) => envVars.get(key) ?? collVars.get(key) ?? globalVars.get(key);
}

/**
 * UI tooltip'i için: öncelik sırası uygulanmış düz değişken listesi.
 * Düşük öncelikli scope önce yazılır; yüksek öncelikli üzerine geçer.
 */
export function listResolvedVariables(
  workspaceId: string,
  collectionId?: string,
): ResolvedVariable[] {
  const out = new Map<string, ResolvedVariable>();
  const layers: Array<{ scope: VariableScope; ownerId: string | undefined }> = [
    { scope: 'global', ownerId: workspaceId },
    { scope: 'collection', ownerId: collectionId },
    { scope: 'environment', ownerId: getActiveEnvironment(workspaceId)?.id },
  ];
  for (const layer of layers) {
    if (!layer.ownerId) continue;
    for (const v of listVariables(layer.scope, layer.ownerId)) {
      if (!v.enabled) continue;
      out.set(v.key, {
        key: v.key,
        value: v.value,
        isSecret: v.isSecret,
        scope: layer.scope,
        ownerId: layer.ownerId,
      });
    }
  }
  return [...out.values()];
}

/** History/log maskeleme için: kullanılan secret değerlerin listesi */
export function collectSecretValues(resolver: VariableResolver, usedKeys: Set<string>): string[] {
  const secrets: string[] = [];
  for (const key of usedKeys) {
    const v = resolver(key);
    if (v?.isSecret && v.value) secrets.push(v.value);
  }
  return secrets;
}
