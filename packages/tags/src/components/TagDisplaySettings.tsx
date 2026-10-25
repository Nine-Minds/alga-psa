'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { ITag, TagDisplayAudience, TagDisplayEntityType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { findAllTagsByType } from '../actions/tagActions';
import { listTagDisplayRules, replaceTagDisplayRules } from '../actions/tagDisplayRuleActions';

const ENTITY_TYPES: readonly TagDisplayEntityType[] = ['contact', 'client'];
const AUDIENCES: readonly TagDisplayAudience[] = ['internal', 'client'];

type RulesByKey = Record<string, string[]>;
const keyOf = (type: TagDisplayEntityType, audience: TagDisplayAudience) => `${type}:${audience}`;
const isError = (value: unknown): boolean => isActionMessageError(value) || isActionPermissionError(value);

/**
 * Settings → Tags → Display on chips. For each entity type (contacts, clients) and audience
 * (internal users, client portal) an ordered list of the tags that show as chips. Saving a list
 * replaces it; an audience with no entries shows no tags.
 */
export function TagDisplaySettings(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  const [definitions, setDefinitions] = useState<Record<TagDisplayEntityType, ITag[]>>({ contact: [], client: [] });
  const [rules, setRules] = useState<RulesByKey>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [contactTags, clientTags, allRules] = await Promise.all([
        findAllTagsByType('contact'),
        findAllTagsByType('client'),
        listTagDisplayRules(),
      ]);
      if (isError(contactTags) || isError(clientTags) || isError(allRules)) {
        toast.error(getErrorMessage([contactTags, clientTags, allRules].find(isError)));
        return;
      }
      setDefinitions({ contact: contactTags as ITag[], client: clientTags as ITag[] });
      const next: RulesByKey = {};
      // A rule whose tag was deleted is dangling: never shown, so skip it here. It goes away the next
      // time that list is saved.
      const existing = new Set([...(contactTags as ITag[]), ...(clientTags as ITag[])].map((d) => d.tag_id as string));
      for (const rule of [...(allRules as Array<{ tagged_type: TagDisplayEntityType; audience: TagDisplayAudience; tag_id: string; position: number }>)].sort(
        (a, b) => a.position - b.position,
      ).filter((rule) => existing.has(rule.tag_id))) {
        (next[keyOf(rule.tagged_type, rule.audience)] ??= []).push(rule.tag_id);
      }
      setRules(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (type: TagDisplayEntityType, audience: TagDisplayAudience, tagIds: string[]) => {
    const key = keyOf(type, audience);
    const previous = rules[key] ?? [];
    setRules((current) => ({ ...current, [key]: tagIds }));
    setSaving(key);
    try {
      const result = await replaceTagDisplayRules(type, audience, tagIds);
      if (isError(result)) {
        setRules((current) => ({ ...current, [key]: previous }));
        toast.error(getErrorMessage(result));
      }
    } finally {
      setSaving(null);
    }
  };

  const move = (list: string[], index: number, delta: -1 | 1): string[] => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };

  if (loading) {
    return <p className="text-sm text-[rgb(var(--color-text-500))]">{t('tagDisplay.loading', 'Loading…')}</p>;
  }

  return (
    <div id="tag-display-settings" className="space-y-8">
      <p className="text-sm text-[rgb(var(--color-text-600))]">
        {t(
          'tagDisplay.description',
          'Choose which tags show as badges next to contacts and clients, and in what order. A list with no tags shows no badges for that audience.',
        )}
      </p>
      {ENTITY_TYPES.map((type) => (
        <section key={type} className="space-y-4">
          <h3 className="text-base font-semibold">
            {type === 'contact' ? t('tagDisplay.contacts', 'Contacts') : t('tagDisplay.clients', 'Clients')}
          </h3>
          {AUDIENCES.map((audience) => {
            const key = keyOf(type, audience);
            const selected = rules[key] ?? [];
            const available = definitions[type].filter((d) => !selected.includes(d.tag_id as string));
            const textById = new Map(definitions[type].map((d) => [d.tag_id as string, d.tag_text]));
            return (
              <div key={key} id={`tag-display-${type}-${audience}`} className="rounded-md border border-[rgb(var(--color-border-200))] p-4 space-y-3">
                <div>
                  <h4 className="text-sm font-medium">
                    {audience === 'internal' ? t('tagDisplay.audienceInternal', 'Internal users') : t('tagDisplay.audienceClient', 'Client portal')}
                  </h4>
                  {audience === 'client' && (
                    <p className="text-xs text-[rgb(var(--color-text-500))]">
                      {t(
                        'tagDisplay.clientNote',
                        "Starts empty. Tags listed here are visible to the client's own users in the client portal.",
                      )}
                    </p>
                  )}
                </div>
                {selected.length === 0 ? (
                  <p className="text-sm text-[rgb(var(--color-text-500))]">{t('tagDisplay.noneSelected', 'No tags shown.')}</p>
                ) : (
                  <ol className="space-y-1">
                    {selected.map((tagId, index) => (
                      <li key={tagId} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{textById.get(tagId) ?? tagId}</span>
                        <Button
                          id={`tag-display-${type}-${audience}-up-${index}`}
                          variant="ghost"
                          size="sm"
                          aria-label={t('tagDisplay.moveUp', 'Move up')}
                          disabled={index === 0 || saving === key}
                          onClick={() => void save(type, audience, move(selected, index, -1))}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          id={`tag-display-${type}-${audience}-down-${index}`}
                          variant="ghost"
                          size="sm"
                          aria-label={t('tagDisplay.moveDown', 'Move down')}
                          disabled={index === selected.length - 1 || saving === key}
                          onClick={() => void save(type, audience, move(selected, index, 1))}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          id={`tag-display-${type}-${audience}-remove-${index}`}
                          variant="ghost"
                          size="sm"
                          aria-label={t('tagDisplay.remove', 'Remove')}
                          disabled={saving === key}
                          onClick={() => void save(type, audience, selected.filter((id) => id !== tagId))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="max-w-xs">
                  <CustomSelect
                    id={`tag-display-${type}-${audience}-add`}
                    options={available.map((d) => ({ value: d.tag_id as string, label: d.tag_text }))}
                    value=""
                    placeholder={t('tagDisplay.addTag', 'Add a tag…')}
                    disabled={available.length === 0 || saving === key}
                    onValueChange={(tagId) => tagId && void save(type, audience, [...selected, tagId])}
                  />
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export default TagDisplaySettings;
