import type { AuthConfig } from '@reqster/shared';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { VariableInput } from '../../components/VariableInput';
import { useT } from '../../lib/i18n';
import { iconProps } from '../../lib/icons';

interface Props {
  auth: AuthConfig | null;
  onChange: (auth: AuthConfig | null) => void;
  /**
   * true (varsayılan, istek/klasör): `null` = "Üstten devral", ayrıca "Auth yok" seçeneği var.
   * false (koleksiyon): devralınacak üst yok; `null` = "Auth yok" ve tek "yok" seçeneği budur.
   */
  inheritable?: boolean;
  /** Değişken vurgusu/tooltip'inin koleksiyon kapsamını çözebilmesi için */
  collectionId?: string;
}

/** Değer yalnızca `{{var}}` referanslarından oluşuyorsa parola maskelenmez. */
const ONLY_VARIABLES = /^\s*(\{\{\s*[\w.-]+\s*\}\}\s*)+$/;

type AuthChoice = 'inherit' | 'none' | 'bearer' | 'basic' | 'apikey';

export function AuthEditor({ auth, onChange, inheritable = true, collectionId }: Props) {
  const t = useT();
  const [passwordRevealed, setPasswordRevealed] = useState(false);
  const choice: AuthChoice = auth === null ? (inheritable ? 'inherit' : 'none') : auth.type;

  const setChoice = (next: AuthChoice) => {
    switch (next) {
      case 'inherit':
        onChange(null);
        break;
      case 'none':
        onChange(inheritable ? { type: 'none' } : null);
        break;
      case 'bearer':
        onChange({ type: 'bearer', bearer: { token: '' } });
        break;
      case 'basic':
        onChange({ type: 'basic', basic: { username: '', password: '' } });
        break;
      case 'apikey':
        onChange({ type: 'apikey', apikey: { key: '', value: '', in: 'header' } });
        break;
    }
  };

  return (
    <div className="auth-editor">
      <select value={choice} onChange={(e) => setChoice(e.target.value as AuthChoice)}>
        {inheritable && <option value="inherit">{t('auth.inherit')}</option>}
        <option value="none">{t('auth.none')}</option>
        <option value="bearer">{t('auth.bearer')}</option>
        <option value="basic">{t('auth.basic')}</option>
        <option value="apikey">{t('auth.apikey')}</option>
      </select>

      {auth?.type === 'bearer' && (
        <VariableInput
          placeholder={t('auth.bearer.placeholder')}
          value={auth.bearer?.token ?? ''}
          collectionId={collectionId}
          onChange={(token) => onChange({ type: 'bearer', bearer: { token } })}
        />
      )}

      {auth?.type === 'basic' && (
        <>
          <VariableInput
            placeholder={t('auth.basic.username')}
            value={auth.basic?.username ?? ''}
            collectionId={collectionId}
            onChange={(username) =>
              onChange({ type: 'basic', basic: { username, password: auth.basic?.password ?? '' } })
            }
          />
          <div className="auth-secret-row">
            <VariableInput
              placeholder={t('auth.basic.password')}
              value={auth.basic?.password ?? ''}
              collectionId={collectionId}
              masked={!passwordRevealed && !ONLY_VARIABLES.test(auth.basic?.password ?? '')}
              onChange={(password) =>
                onChange({ type: 'basic', basic: { username: auth.basic?.username ?? '', password } })
              }
            />
            <button
              type="button"
              className="icon-btn"
              title={passwordRevealed ? t('auth.basic.hidePassword') : t('auth.basic.showPassword')}
              aria-label={passwordRevealed ? t('auth.basic.hidePassword') : t('auth.basic.showPassword')}
              aria-pressed={passwordRevealed}
              onClick={() => setPasswordRevealed(!passwordRevealed)}
            >
              {passwordRevealed ? <EyeOff {...iconProps} /> : <Eye {...iconProps} />}
            </button>
          </div>
        </>
      )}

      {auth?.type === 'apikey' && (
        <>
          <VariableInput
            placeholder={t('auth.apikey.key.placeholder')}
            value={auth.apikey?.key ?? ''}
            collectionId={collectionId}
            onChange={(key) => onChange({ type: 'apikey', apikey: { ...auth.apikey!, key } })}
          />
          <VariableInput
            placeholder={t('auth.apikey.value.placeholder')}
            value={auth.apikey?.value ?? ''}
            collectionId={collectionId}
            onChange={(value) => onChange({ type: 'apikey', apikey: { ...auth.apikey!, value } })}
          />
          <select
            value={auth.apikey?.in ?? 'header'}
            onChange={(e) =>
              onChange({
                type: 'apikey',
                apikey: { ...auth.apikey!, in: e.target.value as 'header' | 'query' },
              })
            }
          >
            <option value="header">{t('auth.apikey.in.header')}</option>
            <option value="query">{t('auth.apikey.in.query')}</option>
          </select>
        </>
      )}
    </div>
  );
}
