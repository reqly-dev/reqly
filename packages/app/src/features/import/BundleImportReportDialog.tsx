import type { ImportReport } from '@reqster/shared';
import { T } from '../../components/T';
import { useT } from '../../lib/i18n';
import { summarizeImportReport } from '../../lib/importReport';
import { dialog } from '../../stores/dialogStore';

/**
 * Reqster paketi içe aktarıldıktan sonra uyarıları (özellikle boş gelen secret değişkenler) bildirim
 * yerine diyalogda gösterir: 5 saniyelik bildirimde kullanıcı hangi değerleri doldurması gerektiğini göremez.
 */
export function showBundleImportReport(report: ImportReport): void {
  void dialog.custom<void>({
    title: <T k="share.importTitle" />,
    cancelValue: undefined,
    className: 'postman-dialog',
    render: (close) => <BundleImportReport report={report} close={close} />,
  });
}

function BundleImportReport({ report, close }: { report: ImportReport; close: () => void }) {
  const t = useT();
  return (
    <>
      <div className="dialog-body postman-body" data-testid="bundle-import-report">
        <p className="postman-summary">{summarizeImportReport(report)}</p>
        {report.warnings.length > 0 && (
          <section className="postman-report">
            <h3>{t('postman.warnings', { count: report.warnings.length })}</h3>
            <p className="hint">{t('share.importSecretsHint')}</p>
            <ul>
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </section>
        )}
        {report.skipped.length > 0 && (
          <section className="postman-report">
            <h3>{t('postman.skipped', { count: report.skipped.length })}</h3>
            <ul>
              {report.skipped.map((s, i) => (
                <li key={i}>
                  <strong>{s.item}</strong> — {s.reason}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="modal-footer">
        <button className="send-btn" data-autofocus onClick={close}>
          {t('common.close')}
        </button>
      </div>
    </>
  );
}
