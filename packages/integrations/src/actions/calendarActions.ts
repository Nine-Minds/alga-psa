'use server';

import logger from '@alga-psa/core/logger';
import { withAuth } from '@alga-psa/auth';
import { isCalendarEnterpriseEdition } from '../lib/calendarAvailability';
import type {
  CalendarProviderConfig,
  CalendarSyncStatus,
  CalendarConflictResolution,
} from '@alga-psa/types';

type CalendarActionContext = {
  tenant: string;
};

type CalendarOAuthParams = {
  provider: 'google' | 'microsoft';
  calendarProviderId?: string;
  redirectUri?: string;
  isPopup?: boolean;
};

type CalendarProviderCreateParams = {
  providerType: 'google' | 'microsoft';
  providerName: string;
  calendarId: string;
  syncDirection: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig: any;
};

type CalendarProviderUpdateParams = {
  providerName?: string;
  calendarId?: string;
  syncDirection?: 'bidirectional' | 'to_external' | 'from_external';
  isActive?: boolean;
  vendorConfig?: any;
};

type EeCalendarActionsModule = {
  initiateCalendarOAuthImpl?: (
    user: any,
    context: CalendarActionContext,
    params: CalendarOAuthParams
  ) => Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string }>;
  getCalendarProvidersImpl?: (
    user: any,
    context: CalendarActionContext
  ) => Promise<{ success: boolean; providers?: CalendarProviderConfig[]; error?: string }>;
  createCalendarProviderImpl?: (
    user: any,
    context: CalendarActionContext,
    params: CalendarProviderCreateParams
  ) => Promise<{ success: boolean; provider?: CalendarProviderConfig; error?: string }>;
  updateCalendarProviderImpl?: (
    user: any,
    context: CalendarActionContext,
    calendarProviderId: string,
    params: CalendarProviderUpdateParams
  ) => Promise<{ success: boolean; provider?: CalendarProviderConfig; error?: string }>;
  deleteCalendarProviderImpl?: (
    user: any,
    context: CalendarActionContext,
    calendarProviderId: string
  ) => Promise<{ success: boolean; error?: string }>;
  syncScheduleEntryToCalendarImpl?: (
    user: any,
    context: CalendarActionContext,
    entryId: string,
    calendarProviderId: string
  ) => Promise<{ success: boolean; error?: string }>;
  syncExternalEventToScheduleImpl?: (
    user: any,
    context: CalendarActionContext,
    externalEventId: string,
    calendarProviderId: string
  ) => Promise<{ success: boolean; error?: string }>;
  resolveCalendarConflictImpl?: (
    user: any,
    context: CalendarActionContext,
    resolution: CalendarConflictResolution
  ) => Promise<{ success: boolean; error?: string }>;
  getScheduleEntrySyncStatusImpl?: (
    user: any,
    context: CalendarActionContext,
    entryId: string
  ) => Promise<{ success: boolean; status?: CalendarSyncStatus[]; error?: string }>;
  syncCalendarProviderImpl?: (
    user: any,
    context: CalendarActionContext,
    calendarProviderId: string
  ) => Promise<{ success: boolean; started?: boolean; error?: string }>;
  retryMicrosoftCalendarSubscriptionRenewalImpl?: (
    user: any,
    context: CalendarActionContext,
    providerId: string
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
};

const CALENDAR_UNAVAILABLE_ERROR = 'Calendar sync is only available in Enterprise Edition.';

let eeCalendarActionsPromise: Promise<EeCalendarActionsModule> | null = null;

function calendarUnavailable<T extends object = {}>(extra?: T): { success: false; error: string } & T {
  return {
    success: false,
    error: CALENDAR_UNAVAILABLE_ERROR,
    ...(extra ?? ({} as T)),
  };
}

async function loadEeCalendarActions(): Promise<EeCalendarActionsModule> {
  if (!eeCalendarActionsPromise) {
    eeCalendarActionsPromise = import('@alga-psa/ee-calendar/actions')
      .then((mod) => mod as EeCalendarActionsModule)
      .catch((error) => {
        logger.warn('[CalendarActions] Failed to load EE calendar action implementation', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {} as EeCalendarActionsModule;
      });
  }

  return eeCalendarActionsPromise;
}

export const initiateCalendarOAuth = withAuth(async (
  user,
  { tenant },
  params: CalendarOAuthParams
): Promise<{ success: true; authUrl: string; state: string } | { success: false; error: string }> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.initiateCalendarOAuthImpl) {
    return calendarUnavailable();
  }

  return ee.initiateCalendarOAuthImpl(user, { tenant }, params);
});

export async function getGoogleAuthUrl(params: {
  calendarProviderId?: string;
  redirectUri?: string;
  isPopup?: boolean;
} = {}): Promise<string> {
  const result = await initiateCalendarOAuth({ provider: 'google', ...params });
  if (result.success === false) {
    throw new Error(result.error);
  }
  return result.authUrl;
}

export async function getMicrosoftAuthUrl(params: {
  calendarProviderId?: string;
  redirectUri?: string;
  isPopup?: boolean;
} = {}): Promise<string> {
  const result = await initiateCalendarOAuth({ provider: 'microsoft', ...params });
  if (result.success === false) {
    throw new Error(result.error);
  }
  return result.authUrl;
}

export const getCalendarProviders = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  providers?: CalendarProviderConfig[];
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.getCalendarProvidersImpl) {
    return calendarUnavailable();
  }

  return ee.getCalendarProvidersImpl(user, { tenant });
});

export const createCalendarProvider = withAuth(async (
  user,
  { tenant },
  params: CalendarProviderCreateParams
): Promise<{
  success: boolean;
  provider?: CalendarProviderConfig;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.createCalendarProviderImpl) {
    return calendarUnavailable();
  }

  return ee.createCalendarProviderImpl(user, { tenant }, params);
});

export const updateCalendarProvider = withAuth(async (
  user,
  { tenant },
  calendarProviderId: string,
  params: CalendarProviderUpdateParams
): Promise<{
  success: boolean;
  provider?: CalendarProviderConfig;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.updateCalendarProviderImpl) {
    return calendarUnavailable();
  }

  return ee.updateCalendarProviderImpl(user, { tenant }, calendarProviderId, params);
});

export const deleteCalendarProvider = withAuth(async (
  user,
  { tenant },
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.deleteCalendarProviderImpl) {
    return calendarUnavailable();
  }

  return ee.deleteCalendarProviderImpl(user, { tenant }, calendarProviderId);
});

export const syncScheduleEntryToCalendar = withAuth(async (
  user,
  { tenant },
  entryId: string,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.syncScheduleEntryToCalendarImpl) {
    return calendarUnavailable();
  }

  return ee.syncScheduleEntryToCalendarImpl(user, { tenant }, entryId, calendarProviderId);
});

export const syncExternalEventToSchedule = withAuth(async (
  user,
  { tenant },
  externalEventId: string,
  calendarProviderId: string
): Promise<{
  success: boolean;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.syncExternalEventToScheduleImpl) {
    return calendarUnavailable();
  }

  return ee.syncExternalEventToScheduleImpl(user, { tenant }, externalEventId, calendarProviderId);
});

export const resolveCalendarConflict = withAuth(async (
  user,
  { tenant },
  resolution: CalendarConflictResolution
): Promise<{
  success: boolean;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.resolveCalendarConflictImpl) {
    return calendarUnavailable();
  }

  return ee.resolveCalendarConflictImpl(user, { tenant }, resolution);
});

export const getScheduleEntrySyncStatus = withAuth(async (
  user,
  { tenant },
  entryId: string
): Promise<{
  success: boolean;
  status?: CalendarSyncStatus[];
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.getScheduleEntrySyncStatusImpl) {
    return calendarUnavailable();
  }

  return ee.getScheduleEntrySyncStatusImpl(user, { tenant }, entryId);
});

export const syncCalendarProvider = withAuth(async (
  user,
  { tenant },
  calendarProviderId: string
): Promise<{
  success: boolean;
  started?: boolean;
  error?: string;
}> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.syncCalendarProviderImpl) {
    return calendarUnavailable();
  }

  return ee.syncCalendarProviderImpl(user, { tenant }, calendarProviderId);
});

export const retryMicrosoftCalendarSubscriptionRenewal = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  if (!isCalendarEnterpriseEdition()) {
    return calendarUnavailable();
  }

  const ee = await loadEeCalendarActions();
  if (!ee.retryMicrosoftCalendarSubscriptionRenewalImpl) {
    return calendarUnavailable();
  }

  return ee.retryMicrosoftCalendarSubscriptionRenewalImpl(user, { tenant }, providerId);
});
