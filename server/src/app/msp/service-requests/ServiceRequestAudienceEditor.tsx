'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { PredicateClause, PredicateGroup, PredicateNode } from '@alga-psa/predicates';
import { isPredicateGroup } from '@alga-psa/predicates';
import type { IContact, ITag } from '@alga-psa/types';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { EntityChip, EntityTagBadges } from '@alga-psa/ui/components/EntityChip';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import { TagFilter } from '@alga-psa/ui/components/tags/TagFilter';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { searchClientsForPicker, type PickerClient } from '@alga-psa/clients/actions/clientPickerActions';
import { getAllContacts } from '@alga-psa/clients/actions';
import { getClientPortalVisibilityGroups } from '@alga-psa/client-portal/actions/client-portal-actions/visibilityGroupActions';
import { isEditorAudience } from '../../../lib/service-requests/audiencePredicate';
import { getServiceRequestAudienceOptionsAction, getServiceRequestAudienceReachAction, updateServiceRequestAudienceAction } from './actions';

export type ServiceRequestAudienceValue = PredicateGroup;
export type ServiceRequestAudienceInitialValue = PredicateGroup;
type Options = Awaited<ReturnType<typeof getServiceRequestAudienceOptionsAction>>;
const clause = (path: string, value: string[]): PredicateClause => ({ path, operator: 'in', value });
const baseOf = (entry: PredicateNode): PredicateClause => isPredicateGroup(entry) ? entry.clauses[0] as PredicateClause : entry;
const idsOf = (entry: PredicateClause): string[] => Array.isArray(entry.value) ? entry.value.filter((id): id is string => typeof id === 'string') : [];
const withTags = (base: PredicateClause, tags: string[]): PredicateNode => tags.length ? { join: 'and', clauses: [base, clause('contact.tags', tags)] } : base;

export function ServiceRequestAudienceEditor({ definitionId, initialAudience, removedReferences = [], onChange, onSaved, disabled = false }: {
  definitionId: string; initialAudience: PredicateGroup; removedReferences?: string[]; onChange?: (value: PredicateGroup) => void; onSaved?: () => void; disabled?: boolean;
}) {
  const { t } = useTranslation('msp/service-requests');
  const [value, setValue] = useState(initialAudience);
  const [options, setOptions] = useState<Options | null>(null);
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [clients, setClients] = useState<PickerClient[]>([]);
  const [clientGroups, setClientGroups] = useState<Options['groups']>([]);
  const [reach, setReach] = useState<{ contacts: number; clients: number } | null>(null);
  const [error, setError] = useState('');
  const editorShape = isEditorAudience(value);
  const entries = value.join === 'or' && editorShape ? value.clauses : [];
  const selected = value.join === 'or' && editorShape;
  const tx = (key: string, fallback: string) => t(`editor.execution.visibility.audience.${key}`, { defaultValue: fallback });
  const update = (next: PredicateGroup) => { setValue(next); onChange?.(next); };
  useEffect(() => { setValue(initialAudience); }, [initialAudience]);
  useEffect(() => {
    Promise.all([getServiceRequestAudienceOptionsAction(), getAllContacts('all')])
      .then(([next, people]) => { setOptions(next); setContacts(people); })
      .catch(() => setError(tx('loadError', 'Could not load audience choices.')));
  }, []);
  const clientIds = useMemo(() => {
    const ids = entries.flatMap((entry) => {
      const base = baseOf(entry);
      if (base.path === 'client.id') return idsOf(base);
      if (base.path === 'contact.group.id') return (options?.groups ?? []).filter((group) => idsOf(base).includes(group.group_id)).map((group) => group.client_id);
      return [];
    });
    return [...new Set(ids)];
  }, [entries, options]);
  useEffect(() => {
    if (clientIds.length) {
      const chunks = Array.from({ length: Math.ceil(clientIds.length / 100) }, (_, index) => clientIds.slice(index * 100, index * 100 + 100));
      void Promise.all(chunks.map((ids) => searchClientsForPicker({ ids, status: 'all' })))
        .then((results) => setClients(results.flatMap((result) => result.clients)))
        .catch(() => setError(tx('loadError', 'Could not load audience choices.')));
    } else setClients([]);
  }, [clientIds.join('|')]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(clientIds.map(async (id) => {
      const groups = await getClientPortalVisibilityGroups(undefined, id);
      return Array.isArray(groups) ? groups.map((group) => ({ group_id: group.group_id, client_id: id, name: group.name })) : [];
    })).then((groups) => { if (!cancelled) setClientGroups(groups.flat()); }).catch(() => { if (!cancelled) setError(tx('loadError', 'Could not load audience choices.')); });
    return () => { cancelled = true; };
  }, [clientIds.join('|')]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => { void getServiceRequestAudienceReachAction(value).then((result) => { if (!cancelled) setReach(result); }).catch(() => { if (!cancelled) setReach(null); }); }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value]);
  const replaceEntry = (index: number, entry: PredicateNode | null) => update({ join: 'or', clauses: entries.flatMap((old, i) => i === index ? entry ? [entry] : [] : [old]) });
  const add = (entry: PredicateNode) => update({ join: 'or', clauses: [...entries, entry] });
  const tagsFor = (kind: 'client' | 'contact') => (options?.tags ?? []).filter((tag) => tag.tagged_type === kind).map((tag) => ({ ...tag, tagged_id: '' } as ITag));
  const tagPicker = (kind: 'client' | 'contact', chosen: string[], change: (ids: string[]) => void, id: string) => {
    const tags = tagsFor(kind);
    const names = tags.filter((tag) => chosen.includes(tag.tag_id)).map((tag) => tag.tag_text);
    return <div className="flex flex-wrap items-center gap-2"><EntityTagBadges tags={tags.filter((tag) => chosen.includes(tag.tag_id))} maxBadges={tags.length} /><TagFilter id={id} tags={tags} selectedTags={names} onToggleTag={(name) => {
      const tag = tags.find((item) => item.tag_text === name); if (!tag) return;
      change(chosen.includes(tag.tag_id) ? chosen.filter((item) => item !== tag.tag_id) : [...chosen, tag.tag_id]);
    }} onClearTags={() => change([])} triggerLabel={tx('chooseTags', 'Choose tags')} /></div>;
  };
  const save = async () => {
    try { const result = await updateServiceRequestAudienceAction(definitionId, value); if (!result.success) throw new Error(result.message); setError(''); toast.success(tx('saved', 'Audience saved')); onSaved?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : tx('saveError', 'Could not save audience.')); }
  };
  return <div id="service-request-audience-editor" className="space-y-3">
    {!editorShape ? <div className="space-y-2"><p>{tx('convertedReadOnly', 'This migrated audience is preserved as a read-only policy.')}</p><Button id="audience-replace" onClick={() => update({ join: 'or', clauses: [] })}>{tx('replace', 'Replace with a new audience')}</Button></div> : <>
      <RadioGroup id="service-request-audience-mode" name="service-request-audience-mode" value={selected ? 'selected' : 'everyone'} disabled={disabled} onChange={(mode) => update(mode === 'selected' ? { join: 'or', clauses: [] } : { join: 'and', clauses: [] })} options={[{ value: 'everyone', label: tx('everyone', 'Everyone') }, { value: 'selected', label: tx('scoped', 'Selected clients and client users') }]} />
      {selected && <div className="space-y-3">
        <ClientPicker id="audience-client-picker" searchClients={searchClientsForPicker} selectedClientId={null} excludeIds={clientIds} disabled={disabled} onSelect={(id) => { if (id) add(clause('client.id', [id])); }} />
        <ContactPicker id="audience-contact-picker" contacts={contacts} value="" onValueChange={(id) => { if (id) add(clause('contact.id', [id])); }} />
        {(['client', 'contact'] as const).map((kind) => <div key={kind}><span>{kind === 'client' ? tx('clientTags', 'Client tags') : tx('contactTags', 'Contact tags')}</span>{tagPicker(kind, [], (ids) => { if (ids.length) add(clause(`${kind}.tags`, ids)); }, `audience-add-${kind}-tag`)}</div>)}
        {entries.map((entry, index) => {
          const base = baseOf(entry); const ids = idsOf(base); const narrowing = isPredicateGroup(entry) ? idsOf(entry.clauses[1] as PredicateClause) : [];
          const group = base.path === 'contact.group.id' ? options?.groups.find((g) => ids.includes(g.group_id)) : undefined;
          const clientId = base.path === 'client.id' ? ids[0] : group?.client_id;
          const client = clients.find((item) => item.client_id === clientId);
          return <div key={`${base.path}-${index}`} className="space-y-2 rounded border p-3">
            {clientId && <EntityChip kind="client" id={clientId} name={client?.client_name ?? tx('missingClient', 'Unavailable client')} tags={client?.displayTags} imageUrl={client?.logoUrl} />}
            {base.path === 'contact.id' && ids.map((id, contactIndex) => {
              const contact = contacts.find((item) => item.contact_name_id === id);
              return <EntityChip key={`${id}-${contactIndex}`} kind="contact" id={id} name={contact?.full_name ?? tx('missingContact', 'Unavailable contact')} tags={contact?.displayTags} imageUrl={contact?.avatarUrl} />;
            })}
            {(base.path === 'client.tags' || base.path === 'contact.tags') && tagPicker(base.path === 'client.tags' ? 'client' : 'contact', ids, (next) => replaceEntry(index, next.length ? withTags(clause(base.path, next), narrowing) : null), `audience-tags-${index}`)}
            {clientId && <><p>{base.path === 'client.id' ? tx('allUsers', 'All users of this client') : tx('onlyGroups', 'Only members of selected groups')}</p>{base.path === 'contact.group.id' && <Button id={`audience-all-${index}`} variant="ghost" onClick={() => replaceEntry(index, withTags(clause('client.id', [clientId]), narrowing))}>{tx('allUsers', 'All users of this client')}</Button>}
              {clientGroups.filter((item) => item.client_id === clientId).map((item) => <Checkbox key={item.group_id} id={`audience-group-${index}-${item.group_id}`} label={`${item.name} (${client?.client_name ?? tx('missingClient', 'Unavailable client')})`} checked={base.path === 'contact.group.id' && ids.includes(item.group_id)} onChange={(event) => { const next = event.target.checked ? [...(base.path === 'contact.group.id' ? ids : []), item.group_id] : ids.filter((id) => id !== item.group_id); replaceEntry(index, next.length ? withTags(clause('contact.group.id', next), narrowing) : null); }} />)}</>}
            <div>{tx('narrowTags', 'Only contacts tagged')}{tagPicker('contact', narrowing, (next) => replaceEntry(index, withTags(base, next)), `audience-narrow-${index}`)}</div>
            <Button id={`audience-remove-${index}`} variant="ghost" onClick={() => replaceEntry(index, null)}>{tx('remove', 'Remove')}</Button>
          </div>;
        })}
        {!entries.length && <p role="status">{tx('emptyWarning', 'Nobody can see this form until you add an audience.')}</p>}
      </div>}
    </>}
    <p>{!selected && editorShape ? tx('allPortalUsers', 'All client portal users') : reach ? t('editor.execution.visibility.audience.reach', { count: reach.contacts, clients: reach.clients, defaultValue: `Visible to ${reach.contacts} contacts at ${reach.clients} clients` }) : tx('reachUnavailable', 'Reach unavailable')}</p>
    {removedReferences.length > 0 && <p role="alert">{tx('removedReferences', 'Unavailable audience selections were removed. Review and save the audience.')} {removedReferences.map((path) => tx(`reference_${path.replace(/\./g, "_")}`, path.startsWith("client") ? "Client selection" : "Contact selection")).join(", ")}</p>}
    {error && <p role="alert">{error}</p>}
    <Button id="service-request-audience-save" disabled={disabled} onClick={save}>{tx('save', 'Save audience')}</Button>
  </div>;
}
