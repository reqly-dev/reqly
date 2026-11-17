import { TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { useT } from '../../lib/i18n';
import { iconProps } from '../../lib/icons';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Verilirse uyarıya "N secret değer düz metin yazılacak" satırı eklenir (paylaşım diyaloğu) */
  affectedCount?: number;
}

/**
 * "Secret değerleri dahil et" onay kutusu + açıkken kırmızı uyarı. Dışa aktarma ve paylaşım
 * diyalogları aynı bileşeni kullanır ki uyarı metni ve görünümü tek yerde dursun.
 */
export function SecretsToggle({ checked, onChange, disabled, affectedCount }: Props) {
  const t = useT();
  const id = useId();
  return (
    <div className="secrets-toggle">
      <label className="postman-item" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          data-testid="include-secrets"
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{t('export.includeSecrets')}</span>
      </label>
      {checked && (
        <div className="secrets-warning" role="alert" data-testid="secrets-warning">
          <TriangleAlert {...iconProps} />
          <div>
            <div>{t('export.secretsWarning')}</div>
            {affectedCount !== undefined && (
              <div className="secrets-warning-count">{t('export.secretsAffected', { count: affectedCount })}</div>
            )}
          </div>
        </div>
      )}
      {!checked && <p className="hint">{t('export.secretsOmitted')}</p>}
    </div>
  );
}
