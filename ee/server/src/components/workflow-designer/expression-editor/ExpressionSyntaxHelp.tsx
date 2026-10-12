'use client';

/**
 * Expression Syntax Help
 *
 * A collapsible cheat-sheet of the expression language, shown next to every
 * expression input. Operator examples are listed here; the function list comes
 * from the runtime function catalog (expressionFunctions.ts), so it always
 * matches what the runtime accepts. A unit test runs every example through the
 * runtime validator.
 */

import React, { useId, useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getWorkflowExpressionExampleSource, listWorkflowExpressionFunctions } from '@alga-psa/workflows/authoring';

export type ExpressionSyntaxExample = {
  /** Stable key, also used for the translation keys. */
  key: string;
  /** Short name of the construct. */
  label: string;
  /** One-line expression showing the construct. */
  example: string;
  /** What the example does, in plain words. */
  description: string;
};

export const EXPRESSION_SYNTAX_EXAMPLES: readonly ExpressionSyntaxExample[] = [
  {
    key: 'field',
    label: 'Field',
    example: 'vars.ticket.ticket.title',
    description: 'A value from the trigger (payload.…) or a saved step result (vars.…).',
  },
  {
    key: 'text',
    label: 'Text',
    example: '"Ticket " & vars.ticket.ticket.ticket_number',
    description: 'Put text in double quotes. Join values with &.',
  },
  {
    key: 'equals',
    label: 'Equals',
    example: 'payload.status = "open"',
    description: 'Use = for equals and != for not equals.',
  },
  {
    key: 'compare',
    label: 'Compare',
    example: 'payload.count >= 5',
    description: 'Compare numbers with >, >=, <, and <=.',
  },
  {
    key: 'andOr',
    label: 'And / or',
    example: 'payload.count > 5 and payload.status != "closed"',
    description: 'Combine conditions with and, or, and parentheses.',
  },
  {
    key: 'list',
    label: 'List',
    example: '[vars.ticket.ticket.assigned_to, payload.actorUserId]',
    description: 'Put values in square brackets, separated by commas, for inputs that take a list.',
  },
  {
    key: 'oneOf',
    label: 'One of',
    example: 'payload.status in ["open", "new"]',
    description: 'True when the value matches any item in the list.',
  },
  {
    key: 'hasValue',
    label: 'Has a value',
    example: 'payload.note != null',
    description: 'True when the field is present and not empty (null).',
  },
  {
    key: 'notTrue',
    label: 'Not',
    example: '(payload.status = "open") = false',
    description: 'Negate a condition by comparing it to false.',
  },
  {
    key: 'choose',
    label: 'Choose a value',
    example: 'payload.urgent = true ? "High" : "Normal"',
    description: 'condition ? value if true : value if false.',
  },
];

export type ExpressionSyntaxFunction = {
  name: string;
  signature: string;
  description: string;
  /** One-line expression from the catalog example. */
  example: string;
};

/** Functions the runtime accepts, from the runtime function catalog. */
export const getExpressionSyntaxFunctions = (): ExpressionSyntaxFunction[] =>
  listWorkflowExpressionFunctions().map((fn) => ({
    name: fn.name,
    signature: fn.signature,
    description: fn.description,
    example: getWorkflowExpressionExampleSource(fn),
  }));

// Expressions stay on one line and scroll sideways in the narrow config panel, so a sample never
// breaks mid-token.
const CODE_SAMPLE_CLASS =
  'block overflow-x-auto whitespace-pre rounded bg-[rgb(var(--color-card))] px-1 py-0.5 font-mono text-[11px] text-[rgb(var(--color-text-800))]';

export interface ExpressionSyntaxHelpProps {
  /** Prefix for element ids; the toggle gets `${idPrefix}-syntax-help-toggle`. */
  idPrefix: string;
  /** Start expanded. Defaults to collapsed. */
  defaultOpen?: boolean;
  className?: string;
}

export const ExpressionSyntaxHelp: React.FC<ExpressionSyntaxHelpProps> = ({
  idPrefix,
  defaultOpen = false,
  className = '',
}) => {
  const { t } = useTranslation('msp/workflows');
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = `${idPrefix}-syntax-help-panel`;
  const headingId = useId();
  const functions = getExpressionSyntaxFunctions();

  return (
    <div className={className}>
      <button
        id={`${idPrefix}-syntax-help-toggle`}
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((previous) => !previous)}
        className="inline-flex items-center gap-1 rounded text-xs text-[rgb(var(--color-text-500))] hover:text-[rgb(var(--color-primary-600))] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <HelpCircle className="h-3 w-3" />
        {t('expressionEditor.syntaxHelp.toggle', { defaultValue: 'Syntax help' })}
      </button>
      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headingId}
          className="mt-2 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-2"
        >
          <p id={headingId} className="mb-2 text-xs text-[rgb(var(--color-text-600))]">
            {t('expressionEditor.syntaxHelp.intro', {
              defaultValue: 'Expressions compute a value from workflow data. Common patterns:',
            })}
          </p>
          <dl className="space-y-1.5">
            {EXPRESSION_SYNTAX_EXAMPLES.map((entry) => (
              <div key={entry.key} className="min-w-0">
                <dt className="text-xs font-medium text-[rgb(var(--color-text-700))]">
                  {t(`expressionEditor.syntaxHelp.examples.${entry.key}.label`, { defaultValue: entry.label })}
                </dt>
                <dd className="min-w-0">
                  <code className={CODE_SAMPLE_CLASS}>{entry.example}</code>
                  <span className="block text-[11px] text-[rgb(var(--color-text-500))]">
                    {t(`expressionEditor.syntaxHelp.examples.${entry.key}.description`, {
                      defaultValue: entry.description,
                    })}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          {functions.length > 0 && (
            <>
              <p className="mb-1 mt-3 text-xs font-medium text-[rgb(var(--color-text-700))]">
                {t('expressionEditor.syntaxHelp.functionsHeading', { defaultValue: 'Functions' })}
              </p>
              <dl className="space-y-1.5">
                {functions.map((fn) => (
                  <div key={fn.name} className="min-w-0">
                    <dt className="min-w-0 overflow-x-auto">
                      <code className="whitespace-pre font-mono text-[11px] font-medium text-[rgb(var(--color-text-800))]">{fn.signature}</code>
                    </dt>
                    <dd className="min-w-0">
                      <span className="block text-[11px] text-[rgb(var(--color-text-500))]">
                        {t(`expressionEditor.syntaxHelp.functions.${fn.name}`, { defaultValue: fn.description })}
                      </span>
                      <code className={CODE_SAMPLE_CLASS}>{fn.example}</code>
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <p id={`${idPrefix}-syntax-help-transforms`} className="mt-3 text-[11px] text-[rgb(var(--color-text-500))]">
            {t('expressionEditor.syntaxHelp.transformsPointer', {
              defaultValue:
                'For heavier text work, add a Transform step instead: Truncate Text, Compose Text, Split Text, Regex Extract, Regex Replace and more. Search the palette for "text" or "regex".',
            })}
          </p>
        </div>
      )}
    </div>
  );
};

export default ExpressionSyntaxHelp;
