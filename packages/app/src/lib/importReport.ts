import type { ImportReport } from '@reqly/shared';
import { t, tn } from './i18n';

/** "İçe aktarıldı: 2 koleksiyon, 5 istek — 1 öğe atlandı — 1 uyarı" biçiminde tek satır özet (aktif dilde) */
export function summarizeImportReport(report: ImportReport): string {
  const parts = [
    report.collections && tn(report.collections, 'import.count.collections_one', 'import.count.collections_other'),
    report.folders && tn(report.folders, 'import.count.folders_one', 'import.count.folders_other'),
    report.requests && tn(report.requests, 'import.count.requests_one', 'import.count.requests_other'),
    report.environments &&
      tn(report.environments, 'import.count.environments_one', 'import.count.environments_other'),
    report.variables && tn(report.variables, 'import.count.variables_one', 'import.count.variables_other'),
  ].filter(Boolean);
  let summary = t('import.summary.prefix', { items: parts.join(', ') || t('import.summary.empty') });
  if (report.skipped.length > 0) {
    summary += ` — ${tn(report.skipped.length, 'import.summary.skipped_one', 'import.summary.skipped_other')}`;
  }
  if (report.warnings.length > 0) {
    summary += ` — ${tn(report.warnings.length, 'import.summary.warnings_one', 'import.summary.warnings_other')}`;
  }
  return summary;
}
