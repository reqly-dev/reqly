import type { VariableModel, VariableScope } from '@reqly/shared';
import { Lock, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useT } from '../../lib/i18n';
import { iconProps } from '../../lib/icons';

interface VarRow {
  id?: string;
  key: string;
  value: string;
  isSecret: boolean;
  enabled: boolean;
}

/** Bir kapsamın (global / ortam / koleksiyon) değişken tablosu; "Kaydet" hepsini anında yazar */
export function VariableTable({
  scope,
  ownerId,
  label,
  onSaved,
}: {
  scope: VariableScope;
  ownerId: string;
  label: string;
  onSaved: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<VarRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = scope === 'global' ? `scope=global` : `scope=${scope}&ownerId=${ownerId}`;
    api
      .get<VariableModel[]>(`/variables?${query}`)
      .then((vars) =>
        setRows(
          vars.map((v) => ({ id: v.id, key: v.key, value: v.value, isSecret: v.isSecret, enabled: v.enabled })),
        ),
      )
      .finally(() => setLoading(false));
  }, [scope, ownerId]);

  const update = (i: number, patch: Partial<VarRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const remove = async (i: number) => {
    const row = rows[i]!;
    if (row.id) await api.delete(`/variables/${row.id}`);
    setRows(rows.filter((_, idx) => idx !== i));
  };

  const saveAll = async () => {
    for (const row of rows) {
      if (row.key.trim() === '') continue;
      await api.put('/variables', {
        scope,
        ownerId,
        key: row.key.trim(),
        value: row.value,
        isSecret: row.isSecret,
        enabled: row.enabled,
      });
    }
    onSaved();
  };

  return (
    <div className="var-table">
      <h3>{label}</h3>
      {loading ? (
        <p className="hint">{t('common.loading')}</p>
      ) : (
        <>
          <div className="var-header">
            <span></span>
            <span>{t('vars.key')}</span>
            <span>{t('vars.value')}</span>
            <span title={t('vars.secret.hint')}>
              <Lock {...iconProps} size={12} />
            </span>
            <span></span>
          </div>
          {rows.map((row, i) => (
            <div className="var-row" key={i}>
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                title={t('vars.enabled')}
              />
              <input
                value={row.key}
                placeholder={t('vars.key.placeholder')}
                onChange={(e) => update(i, { key: e.target.value })}
              />
              <input
                value={row.value}
                type={row.isSecret ? 'password' : 'text'}
                placeholder={t('vars.value.placeholder')}
                onChange={(e) => update(i, { value: e.target.value })}
              />
              <input
                type="checkbox"
                checked={row.isSecret}
                onChange={(e) => update(i, { isSecret: e.target.checked })}
                title={t('vars.secret')}
              />
              <button className="icon-btn" onClick={() => void remove(i)} title={t('common.delete')}>
                <X {...iconProps} />
              </button>
            </div>
          ))}
          <div className="var-actions">
            <button
              className="ghost-btn"
              onClick={() => setRows([...rows, { key: '', value: '', isSecret: false, enabled: true }])}
            >
              <Plus {...iconProps} />
              {t('vars.add')}
            </button>
            <button className="send-btn" onClick={() => void saveAll()}>
              {t('common.save')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
