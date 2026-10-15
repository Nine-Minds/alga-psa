'use client';

import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ContractLineCoverageLine, ServiceContractLineCoverage } from '@alga-psa/types';

type TranslateFn = ReturnType<typeof useTranslation>['t'];

const UNSCOPED_SERVICE_LIMIT = 5;

export interface CoverageMessage {
  key: string;
  text: string;
  /** Contract the message names, for the "View contract" link. */
  line?: ContractLineCoverageLine;
  /** Sub-item of the previous message (rendered as a list item). */
  nested?: boolean;
}

export function contractHref(line: ContractLineCoverageLine): string {
  return `/msp/billing?tab=client-contracts&contractId=${encodeURIComponent(line.contract_id)}&clientContractId=${encodeURIComponent(line.client_contract_id)}`;
}

/**
 * Builds the overlap messages from translation keys. Mirrors the burn rule:
 * a single automatic line means all time on the service bills through the
 * contract; overlapping lines mean only time assigned to a line skips the block.
 */
export function buildCoverageMessages(
  t: TranslateFn,
  coverage: ServiceContractLineCoverage[],
  { unscoped }: { unscoped: boolean },
): CoverageMessage[] {
  const messages: CoverageMessage[] = [];

  if (unscoped) {
    messages.push({
      key: 'intro',
      text: t('coverage.unscopedIntro', {
        defaultValue: 'This block covers all labor, but time on these services bills through a contract line and will not draw it:',
      }),
    });
    for (const service of coverage.slice(0, UNSCOPED_SERVICE_LIMIT)) {
      if (service.assignment === 'when_assigned') {
        messages.push({
          key: `${service.service_id}:assigned`,
          nested: true,
          text: t('coverage.unscopedServiceAssigned', {
            service: service.service_name,
            defaultValue: '{{service}} — when assigned to a contract line',
          }),
        });
        continue;
      }
      for (const line of service.lines) {
        messages.push({
          key: `${service.service_id}:${line.client_contract_id}:${line.contract_line_id}`,
          nested: true,
          line,
          text: t('coverage.unscopedService', {
            service: service.service_name,
            contract: line.contract_name,
            line: line.contract_line_name,
            defaultValue: '{{service}} — {{contract}} / {{line}}',
          }),
        });
      }
    }
    if (coverage.length > UNSCOPED_SERVICE_LIMIT) {
      messages.push({
        key: 'more',
        nested: true,
        text: t('coverage.more', {
          count: coverage.length - UNSCOPED_SERVICE_LIMIT,
          defaultValue: 'and {{count}} more',
        }),
      });
    }
    return messages;
  }

  for (const service of coverage) {
    if (service.assignment === 'automatic') {
      for (const line of service.lines) {
        messages.push({
          key: `${service.service_id}:${line.client_contract_id}:${line.contract_line_id}`,
          line,
          text: t('coverage.oneLine', {
            service: service.service_name,
            contract: line.contract_name,
            line: line.contract_line_name,
            defaultValue: 'Time on {{service}} bills through {{contract}} / {{line}} and will not draw this block.',
          }),
        });
      }
      continue;
    }
    messages.push({
      key: `${service.service_id}:many`,
      text: t('coverage.manyLines', {
        service: service.service_name,
        defaultValue: 'Time on {{service}} that is assigned to a contract line will not draw this block.',
      }),
    });
    messages.push({
      key: `${service.service_id}:label`,
      nested: false,
      text: t('coverage.linesLabel', {
        service: service.service_name,
        defaultValue: 'Contract lines covering {{service}}:',
      }),
    });
    for (const line of service.lines) {
      messages.push({
        key: `${service.service_id}:${line.client_contract_id}:${line.contract_line_id}`,
        nested: true,
        line,
        text: `${line.contract_name} / ${line.contract_line_name}`,
      });
    }
  }
  return messages;
}

interface HourBlockCoverageNoticeProps {
  coverage: ServiceContractLineCoverage[];
  unscoped: boolean;
  variant: 'alert' | 'badge';
  /** Required for the badge variant (stable automation id). */
  blockId?: string;
  /** Open contract links in a new tab (dialogs keep their half-filled form). */
  openLinksInNewTab?: boolean;
}

export default function HourBlockCoverageNotice({
  coverage,
  unscoped,
  variant,
  blockId,
  openLinksInNewTab = false,
}: HourBlockCoverageNoticeProps) {
  const { t } = useTranslation('msp/hour-blocks');
  if (coverage.length === 0) return null;

  const messages = buildCoverageMessages(t, coverage, { unscoped });

  if (variant === 'badge') {
    const content: ReactNode = (
      <div className="max-w-xs space-y-1">
        {messages.map((message) => (
          <p key={message.key} className={message.nested ? 'pl-2' : undefined}>
            {message.text}
          </p>
        ))}
      </div>
    );
    return (
      <Tooltip content={content}>
        <span className="inline-flex" tabIndex={0}>
          <Badge variant="warning" id={`hb-coverage-badge-${blockId}`}>
            {t('coverage.badge', { defaultValue: 'Contract overlap' })}
          </Badge>
        </span>
      </Tooltip>
    );
  }

  return (
    <Alert variant="warning" id="hb-coverage-warning">
      <AlertDescription>
        <ul className="space-y-1">
          {messages.map((message) => (
            <li key={message.key} className={message.nested ? 'ml-4 list-disc' : undefined}>
              {message.text}
              {message.line && (
                <>
                  {' '}
                  <a
                    className="underline"
                    href={contractHref(message.line)}
                    {...(openLinksInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {t('coverage.viewContract', { defaultValue: 'View contract' })}
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
