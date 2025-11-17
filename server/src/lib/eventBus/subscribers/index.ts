import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerSurveySubscriber, unregisterSurveySubscriber } from './surveySubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';
import { registerInternalNotificationSubscriber, unregisterInternalNotificationSubscriber } from './internalNotificationSubscriber';

export async function registerAllSubscribers(): Promise<void> {
  try {
    await registerTicketEmailSubscriber();
    await registerProjectEmailSubscriber();
    await registerSurveySubscriber();
    await registerCalendarSyncSubscriber();
    await registerInternalNotificationSubscriber();
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
  } catch (error) {
    console.error('Failed to unregister subscribers:', error);
  }
}
