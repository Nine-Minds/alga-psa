'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import {
  initiateCalendarOAuthImpl,
  getCalendarProvidersImpl,
  createCalendarProviderImpl,
  updateCalendarProviderImpl,
  deleteCalendarProviderImpl,
  syncScheduleEntryToCalendarImpl,
  syncExternalEventToScheduleImpl,
  resolveCalendarConflictImpl,
  getScheduleEntrySyncStatusImpl,
  syncCalendarProviderImpl,
  retryMicrosoftCalendarSubscriptionRenewalImpl,
} from '../lib/actions/integrations/calendarActions';

type InitiateCalendarOAuthParams = Parameters<typeof initiateCalendarOAuthImpl>[2];
type CreateCalendarProviderParams = Parameters<typeof createCalendarProviderImpl>[2];
type UpdateCalendarProviderParams = Parameters<typeof updateCalendarProviderImpl>[3];
type ResolveCalendarConflictParams = Parameters<typeof resolveCalendarConflictImpl>[2];

export const initiateCalendarOAuth = withAuth(async (
  user,
  { tenant },
  params: InitiateCalendarOAuthParams
) =>
  initiateCalendarOAuthImpl(user as any, { tenant }, params as any)
);

export const getCalendarProviders = withAuth(async (user, { tenant }) =>
  getCalendarProvidersImpl(user as any, { tenant })
);

export const createCalendarProvider = withAuth(async (
  user,
  { tenant },
  params: CreateCalendarProviderParams
) =>
  createCalendarProviderImpl(user as any, { tenant }, params as any)
);

export const updateCalendarProvider = withAuth(
  async (
    user,
    { tenant },
    calendarProviderId: string,
    params: UpdateCalendarProviderParams
  ) =>
    updateCalendarProviderImpl(user as any, { tenant }, calendarProviderId, params as any)
);

export const deleteCalendarProvider = withAuth(async (user, { tenant }, calendarProviderId: string) =>
  deleteCalendarProviderImpl(user as any, { tenant }, calendarProviderId)
);

export const syncScheduleEntryToCalendar = withAuth(
  async (user, { tenant }, entryId: string, calendarProviderId: string) =>
    syncScheduleEntryToCalendarImpl(user as any, { tenant }, entryId, calendarProviderId)
);

export const syncExternalEventToSchedule = withAuth(
  async (user, { tenant }, externalEventId: string, calendarProviderId: string) =>
    syncExternalEventToScheduleImpl(user as any, { tenant }, externalEventId, calendarProviderId)
);

export const resolveCalendarConflict = withAuth(async (
  user,
  { tenant },
  resolution: ResolveCalendarConflictParams
) =>
  resolveCalendarConflictImpl(user as any, { tenant }, resolution as any)
);

export const getScheduleEntrySyncStatus = withAuth(async (user, { tenant }, entryId: string) =>
  getScheduleEntrySyncStatusImpl(user as any, { tenant }, entryId)
);

export const syncCalendarProvider = withAuth(async (user, { tenant }, calendarProviderId: string) =>
  syncCalendarProviderImpl(user as any, { tenant }, calendarProviderId)
);

export const retryMicrosoftCalendarSubscriptionRenewal = withAuth(
  async (user, { tenant }, providerId: string) =>
    retryMicrosoftCalendarSubscriptionRenewalImpl(user as any, { tenant }, providerId)
);
