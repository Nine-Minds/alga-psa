'use server';

import { withAuth } from '@alga-psa/auth/withAuth';

import { listTeamsAuditEventsImpl, listTeamsDeliveriesImpl } from './teamsObservabilityTypes';

export const listTeamsDeliveries = withAuth(listTeamsDeliveriesImpl);
export const listTeamsAuditEvents = withAuth(listTeamsAuditEventsImpl);
