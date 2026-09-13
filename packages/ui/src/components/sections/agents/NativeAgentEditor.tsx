import React from 'react';
import YAML from 'yaml';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsPageLayout } from '../shared/SettingsPageLayout';
import { SettingsSection, SettingsFieldRow, SETTINGS_SELECT_SIZE, SETTINGS_SELECT_ROW_TRIGGER_CLASS } from '../shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { reportSettingsSaveState } from '@/lib/persistence';
import { useAgentsStore, type AgentScope } from '@/stores/useAgentsStore';

const definitionSchema = z.object({ content: z.string(), inherited: z.boolean().optional() });
const nameSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) });

export function NativeAgentEditor({ name, directory, initialScope, isNew, initialContent }: {
  name: string; directory: string | null; initialScope: AgentScope; isNew: boolean; initialContent?: string;
}) {
  const { t } = useI18n();
  const [scope, setScope] = React.useState(initialScope);
  const [content, setContent] = React.useState('');
  const [saved, setSaved] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [inherited, setInherited] = React.useState(true);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const route = React.useCallback((agentName: string) => {
    const query = new URLSearchParams({ name: agentName, scope, inherit: 'true' });
    if (directory) query.set('directory', directory);
    return `/api/omp/agent-definition?${query}`;
  }, [directory, scope]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    if (isNew) {
      const template = initialContent ?? '---\nname: new-agent\ndescription: new-agent\nspawns: []\n---\n';
      setContent(current => current || template); setInherited(true); setLoading(false);
      return () => controller.abort();
    }
    setContent(''); setSaved(''); setInherited(true);
    void (async () => {
      try {
        const response = await runtimeFetch(route(name), { signal: controller.signal });
        if (!response.ok) throw new Error('Agent read failed');
        const definition = definitionSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        setContent(definition.content); setSaved(definition.content); setInherited(definition.inherited ?? false);
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [isNew, name, route, initialContent]);

  const mutate = async (remove = false) => {
    setBusy(true); setFailed(false); reportSettingsSaveState('saving');
    try {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
      const agentName = isNew ? nameSchema.parse(YAML.parse(frontmatter?.[1] ?? '')).name : name;
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (isNew) headers.set('If-None-Match', '*');
      const response = await runtimeFetch(route(agentName), {
        method: remove ? 'DELETE' : 'PUT', headers,
        body: remove ? undefined : JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error('Agent write failed');
      if (!remove && active.current) { setSaved(content); setInherited(false); }
      const store = useAgentsStore.getState();
      if (!await store.loadAgents(directory, true)) throw new Error('Agent list refresh failed');
      if (active.current) {
        store.setAgentDraft(null);
        store.setSelectedAgent(remove ? null : agentName);
      }
      reportSettingsSaveState('saved');
    } catch { if (active.current) setFailed(true); reportSettingsSaveState('error'); }
    finally { if (active.current) setBusy(false); }
  };

  return <SettingsPageLayout title={isNew ? t('settings.agents.page.title.new') : name} showSaveStatus>
    <SettingsSection title={t('settings.agents.native.title')} divider={false}>
      <p className="typography-meta text-muted-foreground mb-4">{t('settings.agents.native.hint')}</p>
      <SettingsFieldRow label={t('settings.agents.page.field.scopePlaceholder')}>
        <Select value={scope} disabled={busy || content !== saved && !isNew} onValueChange={value => { if (value === 'user' || value === 'project') setScope(value); }}>
          <SelectTrigger aria-label={t('settings.agents.page.field.scopePlaceholder')} size={SETTINGS_SELECT_SIZE} className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}><SelectValue>{t(scope === 'user' ? 'settings.common.scope.global' : 'settings.common.scope.project')}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="user">{t('settings.common.scope.global')}</SelectItem><SelectItem value="project" disabled={!directory}>{t('settings.common.scope.project')}</SelectItem></SelectContent>
        </Select>
      </SettingsFieldRow>
      {loading ? <p>{t('common.loading')}</p> : <Textarea aria-label={t('settings.agents.native.title')} value={content} disabled={busy} onChange={event => setContent(event.target.value)} rows={18} className="font-mono typography-meta" />}
      {failed && <p role="alert" className="text-destructive typography-meta">{t('settings.agents.page.toast.saveUnexpectedError')}</p>}
      <div className="flex gap-2 mt-4">
        <Button disabled={busy || loading || !content || content === saved && !inherited} onClick={() => void mutate()}>{t('settings.common.actions.saveChanges')}</Button>
        {!isNew && !inherited && <Button variant="outline" disabled={busy || loading} onClick={() => void mutate(true)}>{t('settings.common.actions.delete')}</Button>}
      </div>
    </SettingsSection>
  </SettingsPageLayout>;
}
