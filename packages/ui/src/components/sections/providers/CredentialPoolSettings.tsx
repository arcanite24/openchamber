import React from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { getCurrentIntlLocale, useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { reportSettingsSaveState } from '@/lib/persistence';
import { SettingsSection, SettingsFieldRow, SettingsCheckboxRow, SettingsControlGroup, SETTINGS_SELECT_SIZE, SETTINGS_SELECT_ROW_TRIGGER_CLASS } from '../shared/SettingsSection';

const policySchema = z.enum(['most-headroom', 'sticky', 'round-robin']);
const poolSchema = z.object({
  settings: z.object({ policy: policySchema, thresholds: z.record(z.string(), z.number()), maxUsageAgeMs: z.number() }),
  accounts: z.array(z.object({
    id: z.number(), label: z.string(), enabled: z.boolean(), allowPaidFallback: z.boolean(),
    lastSelected: z.number(), eligible: z.boolean(), paid: z.boolean(), reason: z.string(),
    fetchedAt: z.number().nullable(), resetAt: z.number().nullable(), blockedUntil: z.number().nullable(),
    windows: z.array(z.object({ id: z.string(), used: z.number().nullable(), resetsAt: z.number().nullable() })),
  })),
});
type Pool = z.infer<typeof poolSchema>;
const windowIds = ['rolling-5h', 'weekly', 'monthly'];

export function CredentialPoolSettings({ onAdded }: { onAdded?: () => void }) {
  const { t } = useI18n();
  const [pool, setPool] = React.useState<Pool | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [key, setKey] = React.useState('');
  const [removeAccount, setRemoveAccount] = React.useState<Pool['accounts'][number] | null>(null);
  const editVersion = React.useRef(0);

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    const version = editVersion.current;
    try {
      const response = await runtimeFetch('/api/omp/pool', { signal });
      if (!response.ok) { setFailed(true); return; }
      const result = poolSchema.safeParse(await response.json());
      if (signal?.aborted || version !== editVersion.current) return;
      if (result.success) { setPool(result.data); setFailed(false); }
      else setFailed(true);
    } catch { if (!signal?.aborted) setFailed(true); }
  }, []);

  React.useEffect(() => {
    if (dirty || busy) return;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [refresh, dirty, busy]);

  const edit = (update: (value: Pool) => Pool) => {
    editVersion.current++;
    setDirty(true);
    setPool(current => current ? update(current) : current);
  };
  const date = (value: number | null) => value ? new Date(value).toLocaleString(getCurrentIntlLocale()) : t('settings.providers.pool.unknown');
  const mutationFailed = () => {
    setFailed(true);
    reportSettingsSaveState('error');
    toast.error(t('settings.providers.pool.saveFailed'));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pool || busy) return;
    setBusy(true);
    reportSettingsSaveState('saving');
    try {
      const settings = await runtimeFetch('/api/omp/pool', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pool.settings) });
      if (!settings.ok) { mutationFailed(); return; }
      for (const account of pool.accounts) {
        const response = await runtimeFetch(`/api/omp/pool/accounts/${account.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: account.label, enabled: account.enabled, allowPaidFallback: account.allowPaidFallback }),
        });
        if (!response.ok) { mutationFailed(); return; }
      }
      setDirty(false);
      setFailed(false);
      reportSettingsSaveState('saved');
      toast.success(t('settings.providers.pool.saved'));
    } catch { mutationFailed(); }
    finally { setBusy(false); }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy || dirty) return;
    setBusy(true);
    reportSettingsSaveState('saving');
    try {
      const response = await runtimeFetch('/api/omp/pool/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key.trim() }) });
      if (!response.ok) { mutationFailed(); return; }
      const result = poolSchema.safeParse(await response.json());
      if (!result.success) { mutationFailed(); return; }
      setPool(result.data);
      setKey('');
      setFailed(false);
      reportSettingsSaveState('saved');
      toast.success(t('settings.providers.pool.added'));
      onAdded?.();
    } catch { mutationFailed(); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!removeAccount || busy || dirty) return;
    setBusy(true);
    try {
      const response = await runtimeFetch(`/api/omp/pool/accounts/${removeAccount.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      const result = poolSchema.safeParse(await response.json());
      if (!result.success) throw new Error();
      setPool(result.data);
      setFailed(false);
      setRemoveAccount(null);
      toast.success(t('settings.providers.pool.removed'));
      onAdded?.();
    } catch {
      setFailed(true);
      toast.error(t('settings.providers.pool.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return <><SettingsSection title={t('settings.providers.pool.title')} divider={false}
    description={t('settings.providers.pool.notice')}
    headerAction={<Button variant="outline" size="xs" disabled={busy || dirty} onClick={() => void refresh()}>{t('settings.providers.pool.refresh')}</Button>}>
    {failed && <p role="alert" className="typography-meta text-destructive">{t('settings.providers.pool.saveFailed')}</p>}
    {!pool && !failed && <p role="status">{t('common.loading')}</p>}
    {pool && <form onSubmit={save} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <SettingsFieldRow label={t('settings.providers.pool.policy')}>
          <Select value={pool.settings.policy} onValueChange={value => { const result = policySchema.safeParse(value); if (result.success) edit(current => ({ ...current, settings: { ...current.settings, policy: result.data } })); }}>
            <SelectTrigger size={SETTINGS_SELECT_SIZE} className={SETTINGS_SELECT_ROW_TRIGGER_CLASS} aria-label={t('settings.providers.pool.policy')}><SelectValue>{t(pool.settings.policy === 'most-headroom' ? 'settings.providers.pool.mostHeadroom' : pool.settings.policy === 'sticky' ? 'settings.providers.pool.sticky' : 'settings.providers.pool.roundRobin')}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="most-headroom">{t('settings.providers.pool.mostHeadroom')}</SelectItem>
              <SelectItem value="sticky">{t('settings.providers.pool.sticky')}</SelectItem>
              <SelectItem value="round-robin">{t('settings.providers.pool.roundRobin')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsFieldRow>
        <SettingsControlGroup title={t('settings.providers.pool.threshold')}>
          {windowIds.map(id => <SettingsFieldRow key={id} label={id}>
            <Input type="number" min={1} max={100} required className="h-8 max-w-[24rem]" aria-label={id}
              value={Number.isNaN(pool.settings.thresholds[id]) ? '' : (pool.settings.thresholds[id] ?? 100)} onChange={event => { const value = event.target.valueAsNumber; edit(current => ({ ...current, settings: { ...current.settings, thresholds: { ...current.settings.thresholds, [id]: value } } })); }} />
          </SettingsFieldRow>)}
        </SettingsControlGroup>
        <SettingsFieldRow label={t('settings.providers.pool.age')}>
          <Input type="number" min={1} max={300} required className="h-8 max-w-[24rem]" aria-label={t('settings.providers.pool.age')}
            value={Number.isNaN(pool.settings.maxUsageAgeMs) ? '' : pool.settings.maxUsageAgeMs / 1000} onChange={event => { const value = event.target.valueAsNumber * 1000; edit(current => ({ ...current, settings: { ...current.settings, maxUsageAgeMs: value } })); }} />
        </SettingsFieldRow>
        {pool.accounts.length === 0 && <p className="typography-meta text-muted-foreground">{t('settings.providers.pool.empty')}</p>}
        {pool.accounts.map(account => <SettingsControlGroup key={account.id} title={account.label || `#${account.id}`} description={account.reason}>
          <SettingsFieldRow label={t('settings.providers.pool.label')}>
            <Input value={account.label} maxLength={120} className="h-8 max-w-[24rem]" aria-label={t('settings.providers.pool.label')}
              onChange={event => { const label = event.target.value; edit(current => ({ ...current, accounts: current.accounts.map(item => item.id === account.id ? { ...item, label } : item) })); }} />
          </SettingsFieldRow>
          <SettingsCheckboxRow checked={account.enabled} label={t('settings.providers.pool.enabled')} onChange={enabled => edit(current => ({ ...current, accounts: current.accounts.map(item => item.id === account.id ? { ...item, enabled } : item) }))} />
          <SettingsCheckboxRow checked={account.allowPaidFallback} label={t('settings.providers.pool.paid')} onChange={allowPaidFallback => edit(current => ({ ...current, accounts: current.accounts.map(item => item.id === account.id ? { ...item, allowPaidFallback } : item) }))} />
          {account.windows.map(window => <SettingsFieldRow key={window.id} label={window.id} description={`${t('settings.providers.pool.reset')}: ${date(window.resetsAt)}`}>
            <span className="typography-meta tabular-nums">{window.used === null ? t('settings.providers.pool.unknown') : `${window.used.toLocaleString(getCurrentIntlLocale(), { maximumFractionDigits: 1 })}%`}</span>
          </SettingsFieldRow>)}
          <dl className="typography-meta text-muted-foreground space-y-1">
            <div><dt className="inline">{t('settings.providers.pool.updated')}: </dt><dd className="inline">{date(account.fetchedAt)}</dd></div>
            <div><dt className="inline">{t('settings.providers.pool.selected')}: </dt><dd className="inline">{date(account.lastSelected)}</dd></div>
            {account.blockedUntil !== null && <div><dt className="inline">{t('settings.providers.pool.cooldown')}: </dt><dd className="inline">{date(account.blockedUntil)}</dd></div>}
          </dl>
          <div className="flex justify-end pt-2">
            <Button type="button" variant="destructive" size="sm" disabled={busy || dirty} onClick={() => setRemoveAccount(account)}>
              {t('settings.providers.pool.remove')}
            </Button>
          </div>
        </SettingsControlGroup>)}
        <Button type="submit" size="sm" disabled={!dirty}>{t('settings.providers.pool.save')}</Button>
      </fieldset>
    </form>}
    <form onSubmit={add} className="pt-5 space-y-3">
      <SettingsFieldRow label={t('settings.providers.page.openCodeGo.apiKey')}>
        <Input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} disabled={busy || dirty} className="h-8 max-w-[24rem]" aria-label={t('settings.providers.page.openCodeGo.apiKey')} />
      </SettingsFieldRow>
      <Button type="submit" variant="outline" size="sm" disabled={busy || dirty || !key.trim()}>{t('settings.providers.pool.add')}</Button>
    </form>
  </SettingsSection>
  <Dialog open={removeAccount !== null} onOpenChange={open => { if (!open && !busy) setRemoveAccount(null); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t('settings.providers.pool.removeTitle')}</DialogTitle>
        <DialogDescription>{t('settings.providers.pool.removeDescription', { label: removeAccount?.label || `#${removeAccount?.id ?? ''}` })}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => setRemoveAccount(null)}>{t('settings.common.actions.cancel')}</Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>{t('settings.providers.pool.remove')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog></>;
}
