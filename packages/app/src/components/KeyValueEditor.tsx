import type { KeyValueItem } from '@reqster/shared';
import { X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { iconProps } from '../lib/icons';
import { VariableInput } from './VariableInput';

interface Props {
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Değişken tooltip'inin koleksiyon kapsamını çözebilmesi için */
  collectionId?: string;
  /** form-data: satır başına Metin/Dosya türü seçici */
  allowFile?: boolean;
}

/**
 * Anahtar/değer listesi. Altta her zaman boş bir "hayalet" satır durur; ona yazılmaya
 * başlanınca satır gerçek olur ve altına yenisi gelir (Postman gibi). Satırlar bilinçli
 * olarak index ile key'lenir: hayalet satır gerçeğe dönüştüğünde aynı index'te kalır,
 * React DOM öğesini yeniden kullanır ve yazarken odak kaybolmaz. Gerçek satır boşalsa da
 * kendiliğinden silinmez; yalnızca × ile silinir.
 */
export function KeyValueEditor({ items, onChange, keyPlaceholder, valuePlaceholder, collectionId, allowFile }: Props) {
  const t = useT();
  const update = (index: number, patch: Partial<KeyValueItem>) => {
    if (index === items.length) {
      onChange([...items, { key: '', value: '', enabled: true, ...patch }]);
      return;
    }
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  const rows: Array<KeyValueItem | null> = [...items, null];

  return (
    <div className="kv-editor">
      {rows.map((item, i) => {
        const ghost = item === null;
        return (
          <div className={`kv-row ${ghost ? 'kv-ghost' : ''}`} key={i}>
            <input
              type="checkbox"
              checked={item?.enabled ?? false}
              disabled={ghost}
              tabIndex={ghost ? -1 : undefined}
              aria-hidden={ghost || undefined}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              title={t('vars.enabled')}
            />
            <input
              className="kv-key"
              value={item?.key ?? ''}
              placeholder={keyPlaceholder ?? t('vars.key.placeholder')}
              onChange={(e) => update(i, { key: e.target.value })}
            />
            {allowFile && (
              <select
                value={item?.type ?? 'text'}
                title={t('kv.type.title')}
                disabled={ghost}
                tabIndex={ghost ? -1 : undefined}
                aria-hidden={ghost || undefined}
                onChange={(e) => update(i, { type: e.target.value as 'text' | 'file' })}
              >
                <option value="text">{t('kv.type.text')}</option>
                <option value="file">{t('kv.type.file')}</option>
              </select>
            )}
            <VariableInput
              className="kv-value"
              value={item?.value ?? ''}
              placeholder={
                item?.type === 'file' ? t('kv.file.placeholder') : (valuePlaceholder ?? t('kv.value.placeholder'))
              }
              onChange={(value) => update(i, { value })}
              collectionId={collectionId}
            />
            <button
              className="icon-btn"
              onClick={() => remove(i)}
              title={t('kv.removeRow')}
              disabled={ghost}
              tabIndex={ghost ? -1 : undefined}
              aria-hidden={ghost || undefined}
            >
              <X {...iconProps} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
