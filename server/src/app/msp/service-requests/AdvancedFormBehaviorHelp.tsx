'use client';

import React from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { copyTextToClipboard } from '@alga-psa/ui/lib/clipboard';
import { VISIBILITY_OPERATORS } from './fieldVisibilityModel';
import {
  ADVANCED_FORM_BEHAVIOR_EXAMPLES,
  CONTEXT_DEFAULT_PLACEHOLDERS,
  VISIBILITY_RULE_SHAPE,
} from './advancedFormBehaviorExamples';

const H = 'text-xs font-semibold';

/** Explains the "Edit as JSON" panel. All prose comes from `editor.execution.advanced.help.*`. */
export function AdvancedFormBehaviorHelp() {
  const { t } = useTranslation('msp/service-requests');
  const k = (suffix: string) => `editor.execution.advanced.help.${suffix}`;

  const copy = async (text: string) => {
    if (await copyTextToClipboard(text)) {
      toast.success(t(k('copied')));
    } else {
      toast.error(t(k('copyFailed')));
    }
  };

  return (
    <div
      id="service-request-form-behavior-help"
      className="space-y-3 text-xs text-[rgb(var(--color-text-700))]"
    >
      <p>{t(k('whatItIs'))}</p>

      <section className="space-y-1">
        <div className={H}>{t(k('ruleShapeTitle'))}</div>
        <p>{t(k('ruleShape'))}</p>
        <pre className="overflow-x-auto rounded border bg-white p-2 font-mono">{VISIBILITY_RULE_SHAPE}</pre>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>{t(k('ruleAll'))}</li>
          <li>{t(k('ruleNone'))}</li>
          <li>{t(k('ruleSource'))}</li>
          <li>{t(k('ruleEarlier'))}</li>
          <li>{t(k('ruleHidden'))}</li>
          <li>{t(k('ruleHiddenAnswers'))}</li>
        </ul>
      </section>

      <section className="space-y-1">
        <div className={H}>{t(k('operatorsTitle'))}</div>
        <p>{t(k('operatorsIntro'))}</p>
        <ul id="service-request-form-behavior-help-operators" className="list-disc space-y-0.5 pl-5">
          {VISIBILITY_OPERATORS.map((operator) => (
            <li key={operator}>
              <code className="font-mono">{operator}</code> — {t(`editor.form.visibility.operators.${operator}`)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <div className={H}>{t(k('contextTitle'))}</div>
        <p>{t(k('contextIntro'))}</p>
        <ul className="list-disc space-y-0.5 pl-5">
          {CONTEXT_DEFAULT_PLACEHOLDERS.map((name) => (
            <li key={name}>
              <code className="font-mono">{`{{${name}}}`}</code> — {t(k(`placeholders.${name}`))}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <div className={H}>{t(k('timingTitle'))}</div>
        <p>{t(k('timing'))}</p>
      </section>

      <section className="space-y-1">
        <div className={H}>{t(k('editionTitle'))}</div>
        <p>{t(k('edition'))}</p>
      </section>

      <section className="space-y-2">
        <div className={H}>{t(k('examplesTitle'))}</div>
        {ADVANCED_FORM_BEHAVIOR_EXAMPLES.map((example) => {
          const json = JSON.stringify(example.config, null, 2);
          return (
            <div key={example.id} id={`service-request-form-behavior-example-${example.id}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span>{t(k(`examples.${example.id}.title`))}</span>
                <Button
                  id={`service-request-form-behavior-example-${example.id}-copy`}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(json)}
                >
                  {t(k('copy'))}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded border bg-white p-2 font-mono">{json}</pre>
              {example.id === 'clientScoped' && <p>{t(k('examples.clientScoped.note'))}</p>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
