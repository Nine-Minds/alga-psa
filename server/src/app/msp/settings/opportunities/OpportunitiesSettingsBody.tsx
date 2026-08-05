'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import CustomTabs, { type TabContent } from '@alga-psa/ui/components/CustomTabs';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toMinorUnits, currencyFractionDigits } from '@alga-psa/core';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import NumberingSettings from '@alga-psa/reference-data/components/settings/NumberingSettings';
import OpportunityStepTemplatesSettings from './OpportunityStepTemplatesSettings';
import {
  readOpportunitySettings,
  runGeneratorNow,
  writeOpportunitySettings,
} from '@alga-psa/opportunities/actions';
import { getDefaultBillingSettings } from '@alga-psa/billing/actions/billingSettingsActions';
import {
  getOpportunityDraftingAvailability,
  getOpportunityVoiceProfile,
  saveOpportunityVoiceProfile,
} from '@enterprise/lib/opportunities/draftingActions';
import type {
  IOpportunitySettings,
  IOpportunityVoiceProfile,
  OpportunityEscalationMode,
  OpportunityGeneratorKey,
} from '@alga-psa/types';

const GENERATORS: Array<{
  key: OpportunityGeneratorKey;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
}> = [
  {
    key: 'renewal',
    labelKey: 'opportunities.settings.generatorRenewal',
    labelFallback: 'Renewals',
    descriptionKey: 'opportunities.settings.generatorRenewalHelp',
    descriptionFallback: 'Contracts approaching their renewal decision date.',
  },
  {
    key: 'tm_conversion',
    labelKey: 'opportunities.settings.generatorTmConversion',
    labelFallback: 'T&M conversion',
    descriptionKey: 'opportunities.settings.generatorTmConversionHelp',
    descriptionFallback: 'Clients whose billed support spend may justify an agreement.',
  },
  {
    key: 'whitespace',
    labelKey: 'opportunities.settings.generatorWhitespace',
    labelFallback: 'Service whitespace',
    descriptionKey: 'opportunities.settings.generatorWhitespaceHelp',
    descriptionFallback: 'Services other agreement clients buy that this client does not.',
  },
  {
    key: 'asset_aging',
    labelKey: 'opportunities.settings.generatorAssetAging',
    labelFallback: 'Asset refresh',
    descriptionKey: 'opportunities.settings.generatorAssetAgingHelp',
    descriptionFallback: 'Aging, out-of-warranty, and end-of-life client assets.',
  },
];

type GeneratorSummary = Awaited<ReturnType<typeof runGeneratorNow>>;

const DEFAULT_SECTION = 'stages-and-steps';

/**
 * Old deep links keep working: the standalone Follow-up tab merged into
 * Stages and Steps, so its section name now lands on the merged tab.
 */
const SECTION_ALIASES: Record<string, string> = {
  'follow-up': 'stages-and-steps',
};

const resolveSection = (section: string | null | undefined): string => {
  const requested = section?.toLowerCase() || DEFAULT_SECTION;
  return SECTION_ALIASES[requested] ?? requested;
};

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="mb-1 text-base font-semibold text-[rgb(var(--color-text-900))]">{title}</h2>
      <p className="text-sm text-[rgb(var(--color-text-500))]">{description}</p>
    </div>
  );
}

/**
 * Opportunity settings, one tab per subject so the page reads the same way the
 * Ticketing and Projects settings do.
 */
export default function OpportunitiesSettingsBody() {
  const { t } = useTranslation('msp/opportunities');
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');
  const [settings, setSettings] = useState<IOpportunitySettings | null>(null);
  const [currencyCode, setCurrencyCode] = useState<string>('USD');
  const [saving, setSaving] = useState(false);
  const [voice, setVoice] = useState<IOpportunityVoiceProfile | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [runningGenerator, setRunningGenerator] = useState<OpportunityGeneratorKey | null>(null);
  const [generatorSummaries, setGeneratorSummaries] = useState<Partial<Record<OpportunityGeneratorKey, GeneratorSummary>>>({});
  const [activeTab, setActiveTab] = useState<string>(() => resolveSection(sectionParam));

  useEffect(() => {
    const target = resolveSection(sectionParam);
    setActiveTab((current) => (current === target ? current : target));
  }, [sectionParam]);

  useEffect(() => {
    let mounted = true;
    Promise.all([readOpportunitySettings(), getDefaultBillingSettings()])
      .then(([loaded, billing]) => {
        if (!mounted) return;
        setSettings(loaded);
        setCurrencyCode((billing as { defaultCurrencyCode?: string })?.defaultCurrencyCode ?? 'USD');
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    getOpportunityDraftingAvailability()
      .then(async (available: boolean) => {
        if (!mounted || !available) return;
        setVoiceAvailable(true);
        const profile = await getOpportunityVoiceProfile();
        if (mounted) setVoice(profile ?? { sample_emails: [], steering_instructions: '' });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const fractionFactor = useMemo(
    () => Math.pow(10, currencyFractionDigits(currencyCode)),
    [currencyCode],
  );

  if (!settings) {
    return <Skeleton className="h-48 w-full" />;
  }

  const patch = (partial: Partial<IOpportunitySettings>) => setSettings({ ...settings, ...partial });
  const numberField = (value: number, apply: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n) && n >= 0) apply(Math.floor(n));
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await writeOpportunitySettings({
        nudge_days: settings.nudge_days,
        interrupt_days: settings.interrupt_days,
        escalation_mode: settings.escalation_mode,
        renewal_lead_days: settings.renewal_lead_days,
        tm_threshold_cents: settings.tm_threshold_cents,
        asset_age_years: settings.asset_age_years,
      });
      setSettings(updated);
      toast.success(t('opportunities.settings.saved', 'Settings saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runGenerator = async (key: OpportunityGeneratorKey) => {
    setRunningGenerator(key);
    try {
      const summary = await runGeneratorNow(key);
      setGeneratorSummaries((current) => ({ ...current, [key]: summary }));
      toast.success(
        t('opportunities.settings.generatorComplete', '{{count}} new suggestions found', {
          count: summary.created + summary.reopened,
        })
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningGenerator(null);
    }
  };

  const saveRow = (
    <div className="flex justify-end">
      <Button id="opportunities-settings-save" size="sm" onClick={save} disabled={saving}>
        {t('common.saveChanges', 'Save changes')}
      </Button>
    </div>
  );

  const tabs: TabContent[] = [
    {
      id: 'stages-and-steps',
      label: t('opportunities.settings.tabs.stagesAndSteps', 'Stages and Steps'),
      content: (
        <div className="max-w-2xl space-y-5">
          <SectionHeading
            title={t('opportunities.settings.stepTemplates', 'Stages and steps')}
            description={t(
              'opportunities.settings.stepTemplatesHelp',
              'Set the steps your team works through at each stage. Every opportunity offers these steps when its plan is filled in, so deals follow the same process.'
            )}
          />
          <OpportunityStepTemplatesSettings />
          <div className="border-t border-[rgb(var(--color-border-200))] pt-5">
            <SectionHeading
              title={t('opportunities.settings.discipline', 'Follow-up reminders')}
              description={t(
                'opportunities.settings.disciplineHelp',
                'How long an opportunity can go without contact before the owner is reminded, and what happens if it stays quiet.'
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                id="opportunities-settings-nudge-days"
                type="number"
                label={t('opportunities.settings.nudgeDays', 'Remind the owner after (days)')}
                value={String(settings.nudge_days)}
                onChange={numberField(settings.nudge_days, (n) => patch({ nudge_days: n }))}
              />
              <Input
                id="opportunities-settings-interrupt-days"
                type="number"
                label={t('opportunities.settings.interruptDays', 'Escalate after (days)')}
                value={String(settings.interrupt_days)}
                onChange={numberField(settings.interrupt_days, (n) => patch({ interrupt_days: n }))}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-[rgb(var(--color-text-700))]">
                  {t('opportunities.settings.escalation', 'Escalation method')}
                </label>
                <CustomSelect
                  id="opportunities-settings-escalation"
                  options={[
                    { value: 'solo', label: t('opportunities.settings.escalationSolo', "Book time on the owner's calendar") },
                    { value: 'team', label: t('opportunities.settings.escalationTeam', 'Notify the owner, then their manager') },
                  ]}
                  value={settings.escalation_mode}
                  onValueChange={(v: string) => patch({ escalation_mode: v as OpportunityEscalationMode })}
                />
              </div>
            </div>
            <div className="mt-4">{saveRow}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'suggestions',
      label: t('opportunities.settings.tabs.suggestions', 'Suggestions'),
      content: (
        <div className="max-w-2xl space-y-5">
          <SectionHeading
            title={t('opportunities.settings.generators', 'Suggestion sources')}
            description={t(
              'opportunities.settings.generatorsHelp',
              'Suggested opportunities are drawn from your contracts, billing history, and assets, with the supporting numbers attached. These thresholds decide what qualifies.'
            )}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              id="opportunities-settings-renewal-lead"
              type="number"
              label={t('opportunities.settings.renewalLead', 'Renewal lead time (days)')}
              value={String(settings.renewal_lead_days)}
              onChange={numberField(settings.renewal_lead_days, (n) => patch({ renewal_lead_days: n }))}
            />
            <CurrencyInput
              id="opportunities-settings-tm-threshold"
              label={t('opportunities.settings.tmThreshold', 'T&M conversion threshold (monthly)')}
              currencyCode={currencyCode}
              value={settings.tm_threshold_cents / fractionFactor}
              onChange={(value?: number) =>
                patch({ tm_threshold_cents: value == null ? 0 : toMinorUnits(value, undefined, currencyCode) })
              }
            />
            <Input
              id="opportunities-settings-asset-age"
              type="number"
              label={t('opportunities.settings.assetAge', 'Asset refresh age (years)')}
              value={String(settings.asset_age_years)}
              onChange={numberField(settings.asset_age_years, (n) => patch({ asset_age_years: n }))}
            />
          </div>
          <div className="divide-y divide-[rgb(var(--color-border-100))] rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-4">
            {GENERATORS.map((generator) => {
              const summary = generatorSummaries[generator.key];
              const running = runningGenerator === generator.key;
              return (
                <div
                  key={generator.key}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[rgb(var(--color-text-800))]">
                      {t(generator.labelKey, generator.labelFallback)}
                    </div>
                    <div className="text-xs text-[rgb(var(--color-text-500))]">
                      {t(generator.descriptionKey, generator.descriptionFallback)}
                    </div>
                    {summary ? (
                      <div
                        id={`opportunities-settings-generator-${generator.key}-summary`}
                        className="mt-1 text-xs font-medium text-[rgb(var(--color-primary-600))]"
                      >
                        {t(
                          'opportunities.settings.generatorSummary',
                          '{{created}} created · {{reopened}} reopened · {{deduped}} already known',
                          {
                            created: summary.created,
                            reopened: summary.reopened,
                            deduped: summary.deduped,
                          }
                        )}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    id={`opportunities-settings-generator-${generator.key}-run`}
                    size="xs"
                    variant="outline"
                    disabled={runningGenerator !== null}
                    onClick={() => void runGenerator(generator.key)}
                  >
                    {running
                      ? t('opportunities.settings.generatorRunning', 'Running…')
                      : t('opportunities.settings.generatorRun', 'Run now')}
                  </Button>
                </div>
              );
            })}
          </div>
          {saveRow}
        </div>
      ),
    },
    {
      id: 'opportunity-numbering',
      label: t('opportunities.settings.tabs.numbering', 'Opportunity Numbering'),
      content: (
        <div className="max-w-2xl space-y-5">
          <SectionHeading
            title={t('opportunities.settings.numbering', 'Opportunity numbering')}
            description={t(
              'opportunities.settings.numberingHelp',
              'Set the prefix and the next number used when an opportunity is created.'
            )}
          />
          <NumberingSettings entityType="OPPORTUNITY" />
        </div>
      ),
    },
  ];

  if (voiceAvailable && voice) {
    tabs.push({
      id: 'email-drafting',
      label: t('opportunities.settings.tabs.drafting', 'Email Drafting'),
      content: (
        <div className="max-w-2xl space-y-5">
          <SectionHeading
            title={t('opportunities.settings.voice', 'Email drafting')}
            description={t(
              'opportunities.settings.voiceHelp',
              'Follow-up drafts are written in your team’s style. Paste a few real emails and describe the tone you want.'
            )}
          />
          <div className="space-y-4">
            <TextArea
              id="opportunities-settings-voice-samples"
              label={t('opportunities.settings.voiceSamples', 'Sample emails (one per block, separated by a blank line)')}
              rows={7}
              value={voice.sample_emails.join('\n\n')}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setVoice({
                  ...voice,
                  sample_emails: e.target.value
                    .split(/\n\s*\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <TextArea
              id="opportunities-settings-voice-steering"
              label={t('opportunities.settings.voiceSteering', 'Tone and style')}
              placeholder={t(
                'opportunities.settings.voiceSteeringPlaceholder',
                'e.g. Plain and short. No exclamation points. One recommendation, not a menu.'
              )}
              rows={3}
              value={voice.steering_instructions}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setVoice({ ...voice, steering_instructions: e.target.value })
              }
            />
            <div className="flex justify-end">
              <Button
                id="opportunities-settings-voice-save"
                size="sm"
                disabled={savingVoice}
                onClick={async () => {
                  setSavingVoice(true);
                  try {
                    await saveOpportunityVoiceProfile(voice);
                    toast.success(t('opportunities.settings.voiceSaved', 'Drafting style saved'));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSavingVoice(false);
                  }
                }}
              >
                {t('common.saveChanges', 'Save changes')}
              </Button>
            </div>
          </div>
        </div>
      ),
    });
  }

  // A stale or hand-typed ?section= must still render a tab rather than nothing.
  const resolvedTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : DEFAULT_SECTION;

  const updateURL = (tabId: string) => {
    const params = new URLSearchParams(window.location.search);
    if (tabId !== DEFAULT_SECTION) {
      params.set('section', tabId);
    } else {
      params.delete('section');
    }
    const query = params.toString();
    window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
  };

  return (
    <div id="opportunities-settings">
      <CustomTabs
        tabs={tabs}
        defaultTab={resolvedTab}
        value={resolvedTab}
        idPrefix="opportunities-settings"
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          updateURL(tabId);
        }}
      />
    </div>
  );
}
