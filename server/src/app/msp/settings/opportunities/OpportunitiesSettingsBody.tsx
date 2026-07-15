'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { toMinorUnits, currencyFractionDigits } from '@alga-psa/core';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import NumberingSettings from '@alga-psa/reference-data/components/settings/NumberingSettings';
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
  label: string;
  description: string;
}> = [
  { key: 'renewal', label: 'Renewals', description: 'Contracts approaching their renewal decision date.' },
  { key: 'tm_conversion', label: 'T&M conversion', description: 'Clients whose billed support spend may justify an agreement.' },
  { key: 'whitespace', label: 'Service whitespace', description: 'Services adopted across the book but missing for a client.' },
  { key: 'asset_aging', label: 'Asset refresh', description: 'Aging, out-of-warranty, and end-of-life client assets.' },
];

type GeneratorSummary = Awaited<ReturnType<typeof runGeneratorNow>>;

/**
 * Opportunity discipline + generator thresholds. The defaults are the
 * methodology; a tenant can loosen or tighten them, never turn the
 * follow-through machinery into decoration.
 */
export default function OpportunitiesSettingsBody() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<IOpportunitySettings | null>(null);
  const [currencyCode, setCurrencyCode] = useState<string>('USD');
  const [saving, setSaving] = useState(false);
  const [voice, setVoice] = useState<IOpportunityVoiceProfile | null>(null);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [runningGenerator, setRunningGenerator] = useState<OpportunityGeneratorKey | null>(null);
  const [generatorSummaries, setGeneratorSummaries] = useState<Partial<Record<OpportunityGeneratorKey, GeneratorSummary>>>({});

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

  if (!settings) {
    return <Skeleton className="h-48 w-full" />;
  }

  const patch = (partial: Partial<IOpportunitySettings>) => setSettings({ ...settings, ...partial });
  const numberField = (value: number, apply: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n) && n >= 0) apply(Math.floor(n));
  };
  const fractionFactor = Math.pow(10, currencyFractionDigits(currencyCode));

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

  return (
    <div id="opportunities-settings" className="max-w-2xl space-y-8">
      <section>
        <h2 className="mb-1 text-base font-semibold text-[rgb(var(--color-text-900))]">
          {t('opportunities.settings.discipline', 'Follow-through')}
        </h2>
        <p className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
          {t(
            'opportunities.settings.disciplineHelp',
            'A quiet deal gets a private nudge first. If it stays quiet, the interrupt puts it on the calendar.'
          )}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            id="opportunities-settings-nudge-days"
            type="number"
            label={t('opportunities.settings.nudgeDays', 'Nudge after (days)')}
            value={String(settings.nudge_days)}
            onChange={numberField(settings.nudge_days, (n) => patch({ nudge_days: n }))}
          />
          <Input
            id="opportunities-settings-interrupt-days"
            type="number"
            label={t('opportunities.settings.interruptDays', 'Interrupt after (days)')}
            value={String(settings.interrupt_days)}
            onChange={numberField(settings.interrupt_days, (n) => patch({ interrupt_days: n }))}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-[rgb(var(--color-text-700))]">
              {t('opportunities.settings.escalation', 'Escalation')}
            </label>
            <CustomSelect
              id="opportunities-settings-escalation"
              options={[
                { value: 'solo', label: t('opportunities.settings.escalationSolo', 'Block time on my calendar') },
                { value: 'team', label: t('opportunities.settings.escalationTeam', 'Notify the owner, then their manager') },
              ]}
              value={settings.escalation_mode}
              onValueChange={(v: string) => patch({ escalation_mode: v as OpportunityEscalationMode })}
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold text-[rgb(var(--color-text-900))]">
          {t('opportunities.settings.generators', 'Generators')}
        </h2>
        <p className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
          {t(
            'opportunities.settings.generatorsHelp',
            'Generators watch your contracts, billing, and assets, and suggest opportunities with the evidence attached.'
          )}
        </p>
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
        <div className="mt-5 divide-y divide-[rgb(var(--color-border-100))] rounded-xl border border-[rgb(var(--color-border-200))] bg-white px-4">
          {GENERATORS.map((generator) => {
            const summary = generatorSummaries[generator.key];
            const running = runningGenerator === generator.key;
            return (
              <div
                key={generator.key}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[rgb(var(--color-text-800))]">{generator.label}</div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">{generator.description}</div>
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
      </section>

      <div className="flex justify-end">
        <Button id="opportunities-settings-save" size="sm" onClick={save} disabled={saving}>
          {t('common.saveChanges', 'Save changes')}
        </Button>
      </div>

      {voiceAvailable && voice ? (
        <section className="border-t border-[rgb(var(--color-border-200))] pt-6">
          <h2 className="mb-1 text-base font-semibold text-[rgb(var(--color-text-900))]">
            {t('opportunities.settings.voice', 'Your voice')}
          </h2>
          <p className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
            {t(
              'opportunities.settings.voiceHelp',
              'Drafts are written the way you write. Paste a couple of real emails and describe the tone you want.'
            )}
          </p>
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
              label={t('opportunities.settings.voiceSteering', 'How you write')}
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
                variant="soft"
                disabled={savingVoice}
                onClick={async () => {
                  setSavingVoice(true);
                  try {
                    await saveOpportunityVoiceProfile(voice);
                    toast.success(t('opportunities.settings.voiceSaved', 'Voice saved'));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : String(err));
                  } finally {
                    setSavingVoice(false);
                  }
                }}
              >
                {t('opportunities.settings.voiceSaveButton', 'Save voice')}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-t border-[rgb(var(--color-border-200))] pt-6">
        <h2 className="mb-1 text-base font-semibold text-[rgb(var(--color-text-900))]">
          {t('opportunities.settings.numbering', 'Opportunity numbering')}
        </h2>
        <p className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
          {t(
            'opportunities.settings.numberingHelp',
            'Customize how opportunity numbers are generated and displayed.'
          )}
        </p>
        <NumberingSettings entityType="OPPORTUNITY" />
      </section>
    </div>
  );
}
