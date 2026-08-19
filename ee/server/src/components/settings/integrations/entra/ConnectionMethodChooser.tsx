'use client';

import React from 'react';
import { ArrowRight, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { MarkList, type MarkListItem } from './MarkList';

export type EntraConnectionMethod = 'direct' | 'cipp';

interface ConnectionMethodChooserProps {
  /** CIPP is offered only when both the tier and the soft-launch flag allow it. */
  cippAvailable: boolean;
  value: EntraConnectionMethod | null;
  onChange: (method: EntraConnectionMethod) => void;
  onContinue: () => void;
  busy?: boolean;
}

const DIRECT_PREREQUISITE_KEYS = [
  'integrations.entra.setup.chooser.direct.prerequisites.partnerRelationship',
  // GDAP alone is not enough: the managedTenants API answers only for partner
  // tenants onboarded to Lighthouse, and a missing onboarding fails the
  // connect after consent — the worst place to learn about it.
  'integrations.entra.setup.chooser.direct.prerequisites.lighthouse',
  'integrations.entra.setup.chooser.direct.prerequisites.globalAdmin',
  'integrations.entra.setup.chooser.direct.prerequisites.appRegistration',
];

const CIPP_PREREQUISITE_KEYS = [
  'integrations.entra.setup.chooser.cipp.prerequisites.instance',
  'integrations.entra.setup.chooser.cipp.prerequisites.apiHost',
  'integrations.entra.setup.chooser.cipp.prerequisites.apiKey',
];

const CONTINUE_LABEL_KEYS: Record<EntraConnectionMethod, string> = {
  direct: 'integrations.entra.setup.chooser.continueDirect',
  cipp: 'integrations.entra.setup.chooser.continueCipp',
};

const REASSURANCE_KEYS: Record<EntraConnectionMethod, string> = {
  direct: 'integrations.entra.setup.chooser.directReassurance',
  cipp: 'integrations.entra.setup.chooser.cippReassurance',
};

/**
 * One decision, stated once, with both answers side by side.
 *
 * Two options that differ in what they cost you are a comparison, so they are
 * laid out as one: each card carries its own prerequisites, and the button
 * underneath names the method you picked rather than saying "Continue" and
 * leaving you to remember which radio you clicked. The options are real
 * focusable radios in a radiogroup rather than clickable divs — the previous
 * chooser was a pair of bare `<div onClick>` cards, unreachable by keyboard and
 * invisible to assistive tech.
 */
export function ConnectionMethodChooser({
  cippAvailable,
  value,
  onChange,
  onContinue,
  busy = false,
}: ConnectionMethodChooserProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');

  const options: Array<{
    method: EntraConnectionMethod;
    labelKey: string;
    descriptionKey: string;
    prerequisiteKeys: string[];
    recommended: boolean;
  }> = [
    {
      method: 'direct',
      labelKey: 'integrations.entra.setup.chooser.direct.label',
      descriptionKey: 'integrations.entra.setup.chooser.direct.description',
      prerequisiteKeys: DIRECT_PREREQUISITE_KEYS,
      recommended: cippAvailable,
    },
    ...(cippAvailable
      ? [
          {
            method: 'cipp' as const,
            labelKey: 'integrations.entra.setup.chooser.cipp.label',
            descriptionKey: 'integrations.entra.setup.chooser.cipp.description',
            prerequisiteKeys: CIPP_PREREQUISITE_KEYS,
            recommended: false,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4" id="entra-connection-method-chooser">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 flex-shrink-0 text-primary-500" aria-hidden="true" />
        <p className="text-sm font-semibold">{t('integrations.entra.setup.chooser.title')}</p>
      </div>

      {cippAvailable ? (
        <Alert variant="info" id="entra-connection-method-recommendation">
          <AlertDescription className="text-sm">
            {t('integrations.entra.setup.chooser.recommendation')}
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        role="radiogroup"
        aria-label={t('integrations.entra.setup.chooser.title')}
        className="grid gap-3 md:grid-cols-2"
        id="entra-connection-method"
      >
        {options.map((option) => {
          const selected = value === option.method;
          const inputId = `entra-connection-method-${option.method}`;
          const prerequisites: MarkListItem[] = option.prerequisiteKeys.map((key) => ({
            id: key,
            mark: 'affirm',
            text: t(key),
          }));

          return (
            <label
              key={option.method}
              htmlFor={inputId}
              data-selected={selected ? 'true' : 'false'}
              className={[
                'flex cursor-pointer flex-col rounded-lg border p-4 transition-colors',
                'focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-1',
                selected
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-border/70 bg-background hover:border-border',
                busy ? 'cursor-not-allowed opacity-70' : '',
              ].join(' ')}
            >
              <span className="flex items-start gap-3">
                <input
                  id={inputId}
                  type="radio"
                  name="entra-connection-method"
                  value={option.method}
                  checked={selected}
                  disabled={busy}
                  onChange={() => onChange(option.method)}
                  className="mt-1 h-4 w-4 flex-shrink-0"
                  style={{ accentColor: 'rgb(var(--color-primary-500))' }}
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{t(option.labelKey)}</span>
                    {option.recommended ? (
                      <Badge variant="secondary" size="sm">
                        {t('integrations.entra.setup.chooser.recommendedBadge')}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {t(option.descriptionKey)}
                  </span>
                </span>
              </span>

              <span className="mt-3 block border-t border-border/60 pt-3">
                <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('integrations.entra.setup.chooser.prerequisitesTitle')}
                </span>
                <MarkList className="mt-2" items={prerequisites} />
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          id="entra-connection-method-continue"
          type="button"
          onClick={onContinue}
          disabled={busy || !value}
        >
          {busy
            ? t('integrations.entra.setup.chooser.continuing')
            : value
              ? t(CONTINUE_LABEL_KEYS[value])
              : t('integrations.entra.setup.chooser.continue')}
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Button>
        {value ? (
          <span className="text-sm text-muted-foreground" id="entra-connection-method-reassurance">
            {t(REASSURANCE_KEYS[value])}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default ConnectionMethodChooser;
