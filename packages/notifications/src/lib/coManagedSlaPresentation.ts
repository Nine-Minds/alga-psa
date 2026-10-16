import type { CoManagedSlaNotification } from '@alga-psa/co-managed';

export function coManagedSlaPresentation(message: CoManagedSlaNotification) {
  const minutes = Math.ceil(Math.abs(message.targetMinutes - message.elapsedMilliseconds / 60000));
  const duration = `${minutes} min`;
  const link = `/msp/co-management/tickets/${message.resource.tenant}/${message.resource.relationshipId}/${message.resource.id}`;
  return { link,
    data: { ticketNumber: message.ticketNumber ?? '—', ticketTitle: message.ticketTitle ?? '—', clientName: '—', priorityName: '—', priority: '—',
      policyName: '—', slaType: message.slaType === 'response' ? 'Response' : 'Resolution', thresholdPercent: message.thresholdPercent,
      remainingTime: duration, timeRemaining: duration, timeOverdue: duration, dueAt: message.dueAt ?? '—', ticketUrl: link },
    metadata: { coManaged: { version: 3, kind: 'sla', resource: message.resource, eventId: message.eventId, obligationId: message.obligationId } },
  };
}
