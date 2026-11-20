import { isBundleFormat, type ImportReport, type ReqsterBundle } from '@reqster/shared';
import { getDb } from '../db/connection.js';
import { msg } from '../i18n/context.js';
import {
  emptyImportReport,
  importPostmanCollection,
  importPostmanEnvironment,
  importPostmanGlobals,
  mergeImportReport,
} from './postman-v2.js';

/**
 * `.reqster.json` paylaşım paketi içe aktarımı. Paket, `exporters/postman-v2.ts`'nin ürettiği
 * Postman v2.1 koleksiyon/ortam belgelerini ve global `values[]`'ı taşır; her parça mevcut Postman
 * importer'ına verilir (ayrı bir eşleme yoktur). Bütün parçalar TEK transaction'dadır: iç importer'ların
 * kendi `db.transaction` çağrıları better-sqlite3'te savepoint'e dönüşür, herhangi bir parça hata verirse
 * hiçbir şey yazılmaz (TASARIM.md §6.1 atomiklik).
 */

export function isReqsterBundle(json: unknown): json is ReqsterBundle {
  return (
    typeof json === 'object' &&
    json !== null &&
    isBundleFormat((json as { format?: unknown }).format)
  );
}

interface SecretLike {
  key?: unknown;
  value?: unknown;
  type?: unknown;
}

/** `type: "secret"` ve değeri boş gelen değişken adları (paket secret'sız üretildiyse kullanıcı uyarılır) */
function emptySecretNames(bundle: ReqsterBundle): string[] {
  const names = new Set<string>();
  const collect = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const v of list as SecretLike[]) {
      if (v && v.type === 'secret' && typeof v.key === 'string' && (v.value === '' || v.value == null)) names.add(v.key);
    }
  };
  for (const c of bundle.collections) collect((c as { variable?: unknown })?.variable);
  for (const e of bundle.environments) collect((e as { values?: unknown })?.values);
  collect(bundle.globals?.values);
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function importBundle(json: unknown, workspaceId: string): ImportReport {
  const bundle = json as ReqsterBundle;
  if (
    !isReqsterBundle(json) ||
    bundle.version !== 1 ||
    !Array.isArray(bundle.collections) ||
    !Array.isArray(bundle.environments) ||
    (bundle.globals !== null && bundle.globals !== undefined && !Array.isArray(bundle.globals?.values))
  ) {
    throw new Error(msg('import.invalidBundle'));
  }

  const report = emptyImportReport();
  const db = getDb();
  try {
    db.transaction(() => {
      for (const collection of bundle.collections) {
        mergeImportReport(report, importPostmanCollection(collection, workspaceId));
      }
      for (const environment of bundle.environments) {
        mergeImportReport(report, importPostmanEnvironment(environment, workspaceId));
      }
      if (bundle.globals) {
        mergeImportReport(report, importPostmanGlobals(bundle.globals.values, workspaceId));
      }
    })();
  } catch (err) {
    throw new Error(msg('import.bundleFailed', { reason: err instanceof Error ? err.message : String(err) }));
  }

  if (bundle.secretsIncluded === false) {
    const names = emptySecretNames(bundle);
    if (names.length > 0) {
      report.warnings.push(msg('import.bundleSecretsEmpty', { count: names.length, names: names.join(', ') }));
    }
  }
  return report;
}
