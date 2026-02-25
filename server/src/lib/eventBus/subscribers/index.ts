import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerSurveySubscriber, unregisterSurveySubscriber } from './surveySubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';
import { registerInternalNotificationSubscriber, unregisterInternalNotificationSubscriber } from './internalNotificationSubscriber';
import { registerSlaSubscriber, unregisterSlaSubscriber } from './slaSubscriber';
import { registerSlaNotificationSubscriber, unregisterSlaNotificationSubscriber } from './slaNotificationSubscriber';

export async function registerAllSubscribers(): Promise<void> {
  try {
    await registerTicketEmailSubscriber();
    await registerProjectEmailSubscriber();
    await registerSurveySubscriber();
    await registerCalendarSyncSubscriber();
    await registerInternalNotificationSubscriber();
    await registerSlaSubscriber();
    await registerSlaNotificationSubscriber();
  } catch (error) {
    console.error('Failed to register subscribers:', error);
  }
}

export async function unregisterAllSubscribers(): Promise<void> {
  try {
    await unregisterTicketEmailSubscriber();
    await unregisterProjectEmailSubscriber();
    await unregisterSurveySubscriber();
    await unregisterCalendarSyncSubscriber();
    await unregisterInternalNotificationSubscriber();
    await unregisterSlaSubscriber();
    await unregisterSlaNotificationSubscriber();
  } catch (error) {
    console.error('Failed to unregister subscribers:', error);
  }
}
