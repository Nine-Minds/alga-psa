import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoManagedSlaNotification } from '@alga-psa/co-managed';
import { renderTemplate } from '@alga-psa/notifications/actions/internal-notification-actions/createNotificationCore';
import { coManagedSlaPresentation } from '@alga-psa/notifications/lib/coManagedSlaPresentation';

const require = createRequire(import.meta.url);
const { TEMPLATES } = require(path.resolve(__dirname, '../../../../migrations/utils/templates/internal/sla.cjs')) as {
  TEMPLATES: Array<{ templateName: string; translations: Record<string, { message: string }> }>;
};
const breachTemplate = TEMPLATES.find(template => template.templateName === 'sla-breach')!.translations.en.message;

function notification(names: Pick<CoManagedSlaNotification, 'policyName' | 'clientName'> = {}): CoManagedSlaNotification {
  return {
    resource: { tenant: 'msp-tenant', relationshipId: 'relationship', kind: 'ticket', id: 'ticket' },
    eventId: 'event', obligationId: 'obligation', slaType: 'resolution', notificationType: 'breach',
    thresholdPercent: 100, dueAt: null, occurredAt: '2026-11-02T12:00:00.000Z', elapsedMilliseconds: 60_000,
    targetMinutes: 45, ticketNumber: 'T-1', ticketTitle: 'Example ticket', ...names,
  };
}

describe('co-managed SLA breach presentation', () => {
  it('renders the shipped breach template without unresolved tokens when names are absent', () => {
    const rendered = renderTemplate(breachTemplate, coManagedSlaPresentation(notification()).data);

    expect(rendered).toBe('SLA BREACH: Ticket #T-1 "Example ticket" has exceeded its Resolution SLA target. Policy: —. Client: —.');
    expect(rendered).not.toMatch(/\{\{\w+\}\}/);
  });

  it('renders policy and client names from the presentation when populated', () => {
    const rendered = renderTemplate(breachTemplate, coManagedSlaPresentation(notification({
      policyName: 'Priority Response', clientName: 'Northwind',
    })).data);

    expect(rendered).toBe('SLA BREACH: Ticket #T-1 "Example ticket" has exceeded its Resolution SLA target. Policy: Priority Response. Client: Northwind.');
    expect(rendered).not.toMatch(/\{\{\w+\}\}/);
  });
});
