'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  'integrations.entra.setup.chooser.direct.prerequisites.globalAdmin',
  'integrations.entra.setup.chooser.direct.prerequisites.appRegistration',
];

const CIPP_PREREQUISITE_KEYS = [
  'integrations.entra.setup.chooser.cipp.prerequisites.instance',
  'integrations.entra.setup.chooser.cipp.prerequisites.apiHost',
  'integrations.entra.setup.chooser.cipp.prerequisites.apiKey',
];

/**
 * One decision, stated once. Both options are real focusable radios in a
 * radiogroup rather than clickable divs — the previous chooser was a pair of
 * bare `<div onClick>` cards, unreachable by keyboard and invisible to
 * assistive tech. Each option carries its own prerequisites so the choice can
 * be made without leaving the screen to find out what it costs.
 */
export function ConnectionMethodChooser({
  cippAvailable,
  value,
  onChange,
  onContinue,
  busy = false,
}: ConnectionMethodChooserProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');

  const renderPrerequisites = (titleKey: string, keys: string[]) => (
    <span className="mt-2 block">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t(titleKey)}
      </span>
      <span className="mt-1 block space-y-0.5">
        {keys.map((key) => (
          <span key={key} className="block text-sm text-muted-foreground">
            · {t(key)}
          </span>
        ))}
      </span>
    </span>
  );

  const options = [
    {
      value: 'direct',
      label: t('integrations.entra.setup.chooser.direct.label'),
      description: (
        <>
          {t('integrations.entra.setup.chooser.direct.description')}
          {renderPrerequisites(
            'integrations.entra.setup.chooser.prerequisitesTitle',
            DIRECT_PREREQUISITE_KEYS
          )}
        </>
      ),
    },
    ...(cippAvailable
      ? [
          {
            value: 'cipp',
            label: t('integrations.entra.setup.chooser.cipp.label'),
            description: (
              <>
                {t('integrations.entra.setup.chooser.cipp.description')}
                {renderPrerequisites(
                  'integrations.entra.setup.chooser.prerequisitesTitle',
                  CIPP_PREREQUISITE_KEYS
                )}
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4" id="entra-connection-method-chooser">
      <div>
        <p className="text-sm font-semibold">{t('integrations.entra.setup.chooser.title')}</p>
        {cippAvailable ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('integrations.entra.setup.chooser.recommendation')}
          </p>
        ) : null}
      </div>

      <RadioGroup
        id="entra-connection-method"
        name="entra-connection-method"
        label={t('integrations.entra.setup.chooser.title')}
        options={options}
        value={value || ''}
        onChange={(next) => onChange(next as EntraConnectionMethod)}
        disabled={busy}
      />

      <Button
        id="entra-connection-method-continue"
        type="button"
        onClick={onContinue}
        disabled={busy || !value}
      >
        {busy
          ? t('integrations.entra.setup.chooser.continuing')
          : t('integrations.entra.setup.chooser.continue')}
      </Button>
    </div>
  );
}

export default ConnectionMethodChooser;
