import type { ProxyPatch, ProxyProfile, ProxyUpsert } from '@reqster/shared';
import { Pencil, Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { T } from '../../components/T';
import { useT } from '../../lib/i18n';
import { iconProps } from '../../lib/icons';
import { useAppStore } from '../../stores/appStore';
import { dialog } from '../../stores/dialogStore';

/** Proxy profilleri: liste (aktif radyo, düzenle, sil) + ekle/düzenle formu */
export function showProxyManager(): void {
  void dialog.custom<void>({
    title: <T k="proxy.dialog.title" />,
    cancelValue: undefined,
    className: 'proxy-dialog',
    render: (close) => (
      <>
        <div className="dialog-body">
          <ProxyManager />
        </div>
        <div className="modal-footer">
          <button className="send-btn" onClick={() => close()}>
            <T k="common.close" />
          </button>
        </div>
      </>
    ),
  });
}

interface FormState {
  name: string;
  url: string;
  username: string;
  password: string;
  /** Virgülle ayrılmış metin; gönderimde diziye çevrilir */
  bypass: string;
}

type Editing = { mode: 'new' } | { mode: 'edit'; proxy: ProxyProfile };

function toForm(proxy?: ProxyProfile): FormState {
  return {
    name: proxy?.name ?? '',
    url: proxy?.url ?? '',
    username: proxy?.username ?? '',
    password: '',
    bypass: proxy?.bypass.join(', ') ?? '',
  };
}

function parseBypass(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function ProxyManager() {
  const t = useT();
  const proxies = useAppStore((s) => s.proxies);
  const activateProxy = useAppStore((s) => s.activateProxy);
  const deleteProxy = useAppStore((s) => s.deleteProxy);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeId = proxies.find((p) => p.isActive)?.id ?? null;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (proxy: ProxyProfile) => {
    const ok = await dialog.confirm({
      title: t('proxy.delete.title'),
      message: t('proxy.delete.message', { name: proxy.name, url: proxy.url }),
      danger: true,
    });
    if (!ok) return;
    await run(() => deleteProxy(proxy.id));
    if (editing?.mode === 'edit' && editing.proxy.id === proxy.id) setEditing(null);
  };

  return (
    <div className="proxy-manager">
      <div className="proxy-list" role="radiogroup" aria-label={t('proxy.list.aria')}>
        <label className="proxy-row">
          <input
            type="radio"
            name="active-proxy"
            checked={activeId === null}
            onChange={() => void run(() => activateProxy(null))}
            title={t('proxy.useNone')}
          />
          <span className="proxy-name">{t('proxy.none')}</span>
          <span className="proxy-url hint">{t('proxy.direct')}</span>
        </label>
        {proxies.map((proxy) => (
          <div key={proxy.id} className={`proxy-row ${proxy.isActive ? 'active' : ''}`}>
            <input
              type="radio"
              name="active-proxy"
              checked={proxy.isActive}
              onChange={() => void run(() => activateProxy(proxy.id))}
              title={t('proxy.makeActive')}
              aria-label={t('proxy.activeAria', { name: proxy.name })}
            />
            <span className="proxy-name" title={proxy.name}>
              {proxy.name}
            </span>
            <span className="proxy-url" title={proxy.url}>
              {proxy.url}
            </span>
            <button
              className="icon-btn"
              title={t('common.edit')}
              aria-label={t('proxy.editAria', { name: proxy.name })}
              onClick={() => {
                setError(null);
                setEditing({ mode: 'edit', proxy });
              }}
            >
              <Pencil {...iconProps} />
            </button>
            <button
              className="icon-btn"
              title={t('common.delete')}
              aria-label={t('proxy.deleteAria', { name: proxy.name })}
              onClick={() => void remove(proxy)}
            >
              <X {...iconProps} />
            </button>
          </div>
        ))}
        {proxies.length === 0 && <p className="hint">{t('proxy.empty')}</p>}
      </div>

      {editing ? (
        <ProxyForm
          key={editing.mode === 'edit' ? editing.proxy.id : 'new'}
          editing={editing}
          onDone={() => setEditing(null)}
        />
      ) : (
        <button
          className="ghost-btn proxy-add-btn"
          onClick={() => {
            setError(null);
            setEditing({ mode: 'new' });
          }}
        >
          <Plus {...iconProps} />
          {t('proxy.new')}
        </button>
      )}
      {error && <p className="hint warn">{error}</p>}
    </div>
  );
}

function ProxyForm({ editing, onDone }: { editing: Editing; onDone: () => void }) {
  const t = useT();
  const createProxy = useAppStore((s) => s.createProxy);
  const updateProxy = useAppStore((s) => s.updateProxy);
  const existing = editing.mode === 'edit' ? editing.proxy : null;
  const [form, setForm] = useState<FormState>(() => toForm(existing ?? undefined));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (change: Partial<FormState>) => setForm((f) => ({ ...f, ...change }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const common = {
      name: form.name.trim(),
      url: form.url.trim(),
      username: form.username.trim() === '' ? null : form.username.trim(),
      bypass: parseBypass(form.bypass),
    };
    try {
      if (existing) {
        // Parola boş bırakıldıysa gönderilmez (sunucuda mevcut parola korunur)
        const patch: ProxyPatch = form.password === '' ? common : { ...common, password: form.password };
        await updateProxy(existing.id, patch);
      } else {
        const input: ProxyUpsert = form.password === '' ? common : { ...common, password: form.password };
        await createProxy(input);
      }
      onDone();
    } catch (err) {
      // Zod mesajı sunucudan gelir (ör. "Proxy adresi http:// ya da https:// ile başlamalı")
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="proxy-form" onSubmit={(e) => void submit(e)}>
      <h3>{existing ? t('proxy.edit.title', { name: existing.name }) : t('proxy.new')}</h3>
      <label className="proxy-field">
        <span>{t('proxy.form.name')}</span>
        <input
          value={form.name}
          onChange={(e) => edit({ name: e.target.value })}
          placeholder={t('proxy.form.name.placeholder')}
        />
      </label>
      <label className="proxy-field">
        <span>{t('proxy.form.url')}</span>
        <input
          value={form.url}
          onChange={(e) => edit({ url: e.target.value })}
          placeholder="http://host:port"
          spellCheck={false}
        />
      </label>
      <label className="proxy-field">
        <span>{t('proxy.form.username')}</span>
        <input value={form.username} onChange={(e) => edit({ username: e.target.value })} autoComplete="off" />
      </label>
      <label className="proxy-field">
        <span>{t('proxy.form.password')}</span>
        <input
          type="password"
          value={form.password}
          onChange={(e) => edit({ password: e.target.value })}
          placeholder={existing?.hasPassword ? t('proxy.form.password.unchanged') : ''}
          autoComplete="new-password"
        />
      </label>
      <label className="proxy-field">
        <span>{t('proxy.form.bypass')}</span>
        <input
          value={form.bypass}
          onChange={(e) => edit({ bypass: e.target.value })}
          placeholder="localhost, intranet.local, .corp.example.com"
          spellCheck={false}
        />
      </label>
      <p className="hint">
        {t('proxy.form.bypass.hint.separate')} {t('proxy.form.bypass.hint.exact')} (<code>intranet.local</code>),{' '}
        {t('proxy.form.bypass.hint.suffix')} (<code>{t('proxy.form.bypass.hint.suffixExample')}</code>){' '}
        {t('proxy.form.bypass.hint.or')} <code>*</code> {t('proxy.form.bypass.hint.tail')}
      </p>
      {error && <p className="hint warn proxy-form-error">{error}</p>}
      <div className="proxy-form-actions">
        <button type="button" className="ghost-btn" onClick={onDone} disabled={saving}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="send-btn" disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
