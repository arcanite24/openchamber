import React from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SettingsPageLayout } from '../shared/SettingsPageLayout';
import { SettingsSection, SettingsFieldRow, SETTINGS_SELECT_SIZE, SETTINGS_SELECT_ROW_TRIGGER_CLASS } from '../shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { reportSettingsSaveState } from '@/lib/persistence';

const summarySchema = z.object({
  scope: z.enum(['user', 'project']), appliesTo: z.literal('new-workers'),
  servers: z.array(z.object({ name: z.string(), type: z.enum(['stdio', 'http', 'sse']), enabled: z.boolean(), timeout: z.number().optional(), requestIdFormat: z.enum(['number', 'string']), configuredFields: z.array(z.string()) })),
});
const fieldsSchema = z.record(z.string(), z.json());
const template = '{\n  "command": "",\n  "args": []\n}';
const oauthSchema = z.object({ state: z.string(), status: z.enum(['pending', 'exchanging', 'complete', 'failed', 'cancelled', 'expired']), expiresAt: z.number(), authorizationUrl: z.string().url().optional() });

function NativeMcpAuthorization({ query, disabled }: { query: string; disabled: boolean }) {
  const { t } = useI18n();
  const [attempt, setAttempt] = React.useState<z.infer<typeof oauthSchema> | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const lifetime = React.useRef(new AbortController());
  React.useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    setBusy(true);
    void (async () => {
      try {
        const response = await runtimeFetch(`/api/omp/mcp-oauth?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Authorization recovery failed');
        const recovered = oauthSchema.nullable().parse(await response.json());
        if (!controller.signal.aborted) { setAttempt(recovered); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [query]);
  const pending = attempt?.status === 'pending' || attempt?.status === 'exchanging';
  const state = attempt?.state;
  React.useEffect(() => {
    if (!pending || !state) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await runtimeFetch(`/api/omp/mcp-oauth?state=${encodeURIComponent(state)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Authorization status failed');
        const next = oauthSchema.parse(await response.json());
        if (!controller.signal.aborted) { setAttempt(next); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [state, pending]);
  const update = async (cancel = false) => {
    const controller = lifetime.current;
    if (busy || controller.signal.aborted) return;
    setBusy(true); setFailed(false);
    try {
      const response = await runtimeFetch(cancel ? `/api/omp/mcp-oauth?state=${encodeURIComponent(attempt!.state)}` : `/api/omp/mcp-oauth?${query}`, { method: cancel ? 'DELETE' : 'POST', signal: controller.signal });
      if (!response.ok) throw new Error('Authorization request failed');
      const next = oauthSchema.parse(await response.json());
      if (!controller.signal.aborted) setAttempt(next);
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <SettingsFieldRow label={t('settings.mcp.page.auth.authorizationUrl')}>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={disabled || busy || pending} onClick={() => void update()}>{t('settings.mcp.page.actions.authorize')}</Button>
      {attempt?.authorizationUrl && <Button variant="outline" asChild><a href={attempt.authorizationUrl} target="_blank" rel="noopener noreferrer">{t('settings.mcp.page.actions.openInBrowser')}</a></Button>}
      {pending && <Button variant="outline" disabled={busy || attempt?.status === 'exchanging'} onClick={() => void update(true)}>{t('settings.common.actions.cancel')}</Button>}
      <span role="status" className="typography-meta">{attempt?.status === 'complete' ? t('settings.providers.page.toast.oauthCompleted') : pending ? t('common.loading') : null}</span>
      {(failed || attempt?.status === 'failed' || attempt?.status === 'expired') && <span role="alert" className="typography-meta text-destructive">{t('settings.mcp.native.error')}</span>}
    </div>
  </SettingsFieldRow>;
}

export function NativeMcpPage({ directory }: { directory: string | null }) {
  const { t } = useI18n();
  const [scope, setScope] = React.useState<'user' | 'project'>('user');
  const [servers, setServers] = React.useState<z.infer<typeof summarySchema>['servers']>([]);
  const [selected, setSelected] = React.useState('');
  const [name, setName] = React.useState('');
  const [content, setContent] = React.useState(template);
  const [saved, setSaved] = React.useState(template);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const lifetime = React.useRef<AbortController | null>(null);
  const query = new URLSearchParams({ scope });
  if (directory) query.set('directory', directory);
  const url = `/api/omp/mcp-config?${query}`;

  React.useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setLoading(true); setFailed(false); setServers([]); setSelected(''); setName(''); setContent(template); setSaved(template);
    void (async () => {
      try {
        const response = await runtimeFetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('MCP read failed');
        const result = summarySchema.parse(await response.json());
        if (!controller.signal.aborted) setServers(result.servers);
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [url]);

  const select = (value: string) => {
    const server = servers.find(item => item.name === value);
    setSelected(server?.name ?? ''); setName(server?.name ?? '');
    const next = server ? JSON.stringify({ enabled: server.enabled, timeout: server.timeout, requestIdFormat: server.requestIdFormat }, null, 2) : template;
    setContent(next); setSaved(next);
    setFailed(false);
  };
  const mutate = async (remove = false) => {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted || busy) return;
    setBusy(true); setFailed(false); reportSettingsSaveState('saving');
    try {
      const serverName = z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/).parse(name);
      const body = remove ? undefined : JSON.stringify(fieldsSchema.parse(JSON.parse(content)));
      const response = await runtimeFetch(`${url}&name=${encodeURIComponent(serverName)}`, {
        method: remove ? 'DELETE' : selected ? 'PATCH' : 'POST',
        signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!response.ok) throw new Error('MCP write failed');
      const result = summarySchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setServers(result.servers); setDeleting(false);
      const server = result.servers.find(item => item.name === serverName);
      setSelected(server?.name ?? ''); setName(server?.name ?? '');
      // Clear any entered connection values after saving; the response contains only safe summaries.
      const next = server ? JSON.stringify({ enabled: server.enabled, timeout: server.timeout, requestIdFormat: server.requestIdFormat }, null, 2) : template;
      setContent(next); setSaved(next);
      reportSettingsSaveState('saved');
    } catch { if (!controller.signal.aborted) { setFailed(true); reportSettingsSaveState('error'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const dirty = content !== saved || !selected && name !== '';
  return <SettingsPageLayout title={t('settings.mcp.sidebar.title')} showSaveStatus>
    <SettingsSection title={t('settings.mcp.native.title')} divider={false} settingsItem="mcp.native">
      <p className="typography-meta text-muted-foreground mb-4">{t('settings.mcp.native.hint')}</p>
      <SettingsFieldRow label={t('settings.agents.page.field.scopePlaceholder')}>
        <Select value={scope} disabled={busy || dirty} onValueChange={value => { if (value === 'user' || value === 'project') setScope(value); }}>
          <SelectTrigger aria-label={t('settings.agents.page.field.scopePlaceholder')} size={SETTINGS_SELECT_SIZE} className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}><SelectValue>{t(scope === 'user' ? 'settings.common.scope.global' : 'settings.common.scope.project')}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="user">{t('settings.common.scope.global')}</SelectItem><SelectItem value="project" disabled={!directory}>{t('settings.common.scope.project')}</SelectItem></SelectContent>
        </Select>
      </SettingsFieldRow>
      <SettingsFieldRow label={t('settings.mcp.page.server.title')}>
        <Select value={selected || '$new'} disabled={busy || loading || dirty} onValueChange={value => { if (value !== null) select(value === '$new' ? '' : value); }}>
          <SelectTrigger aria-label={t('settings.mcp.page.server.title')} size={SETTINGS_SELECT_SIZE} className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}><SelectValue>{selected || t('settings.common.actions.create')}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="$new">{t('settings.common.actions.create')}</SelectItem>{servers.map(server => <SelectItem key={server.name} value={server.name}>{server.name}</SelectItem>)}</SelectContent>
        </Select>
      </SettingsFieldRow>
      <SettingsFieldRow label={t('settings.mcp.page.server.name')}>
        <Input value={name} disabled={busy || !!selected} onChange={event => setName(event.target.value)} aria-label={t('settings.mcp.page.server.name')} className="max-w-[40ch]" />
      </SettingsFieldRow>
      {loading ? <p>{t('common.loading')}</p> : <Textarea aria-label={t('settings.mcp.native.title')} value={content} onChange={event => setContent(event.target.value)} disabled={busy} rows={14} className="font-mono typography-meta" />}
      {failed && <p role="alert" className="typography-meta text-destructive">{t('settings.mcp.native.error')}</p>}
      {servers.some(server => server.name === selected && server.type !== 'stdio' && server.enabled) && <NativeMcpAuthorization key={`${url}:${selected}`} query={`${query}&name=${encodeURIComponent(selected)}`} disabled={busy || dirty} />}
      <div className="flex gap-2 mt-4">
        <Button disabled={busy || loading || !name} onClick={() => void mutate()}>{t('settings.common.actions.saveChanges')}</Button>
        {dirty && <Button variant="outline" disabled={busy} onClick={() => select(selected)}>{t('settings.common.actions.cancel')}</Button>}
        {selected && <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>{t('settings.common.actions.delete')}</Button>}
      </div>
    </SettingsSection>
    <Dialog open={deleting} onOpenChange={open => { if (!busy) setDeleting(open); }}>
      <DialogContent><DialogHeader><DialogTitle>{t('settings.mcp.page.deleteDialog.title', { name })}</DialogTitle></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>{t('settings.common.actions.cancel')}</Button><Button variant="destructive" disabled={busy} onClick={() => void mutate(true)}>{t('settings.common.actions.delete')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </SettingsPageLayout>;
}
