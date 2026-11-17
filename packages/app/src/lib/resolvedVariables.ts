import type { ResolvedVariable } from '@reqly/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAppStore } from '../stores/appStore';

/** Aynı bağlam için tek istek: collectionId + değişken versiyonu başına önbellek */
const resolvedCache = new Map<string, Promise<ResolvedVariable[]>>();

function fetchResolvedVariables(
  collectionId: string | undefined,
  version: number,
): Promise<ResolvedVariable[]> {
  const key = `${collectionId ?? ''}|${version}`;
  if (!resolvedCache.has(key)) {
    if (resolvedCache.size > 16) resolvedCache.clear();
    const query = collectionId ? `?collectionId=${collectionId}` : '';
    resolvedCache.set(key, api.get<ResolvedVariable[]>(`/variables/resolved${query}`));
  }
  return resolvedCache.get(key)!;
}

/** `{{var}}` vurgulaması yapan tüm bileşenlerin (VariableInput, CodeEditor) paylaştığı hook */
export function useResolvedVariables(collectionId: string | undefined): Map<string, ResolvedVariable> {
  const variablesVersion = useAppStore((s) => s.variablesVersion);
  const [resolved, setResolved] = useState<Map<string, ResolvedVariable>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetchResolvedVariables(collectionId, variablesVersion).then((vars) => {
      if (!cancelled) setResolved(new Map(vars.map((v) => [v.key, v])));
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId, variablesVersion]);

  return resolved;
}
