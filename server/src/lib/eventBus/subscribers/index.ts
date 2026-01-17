import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerSurveySubscriber, unregisterSurveySubscriber } from './surveySubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';
import { registerInternalNotificationSubscriber, unregisterInternalNotificationSubscriber } from './internalNotificationSubscriber';
import { registerGuardNotificationSubscriber, unregisterGuardNotificationSubscriber } from './guardNotificationSubscriber';

export async function registerAllSubscribers(): Promise<void> {
  try {
    await registerTicketEmailSubscriber();
    await registerProjectEmailSubscriber();
    await registerSurveySubscriber();
    await registerCalendarSyncSubscriber();
    await registerInternalNotificationSubscriber();
    // Alga Guard notification subscriber (EE feature)
    if (process.env.EDITION === 'enterprise') {
      await registerGuardNotificationSubscriber();
    }
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
    // Alga Guard notification subscriber (EE feature)
    if (process.env.EDITION === 'enterprise') {
      await unregisterGuardNotificationSubscriber();
    }
  } catch (error) {
    console.error('Failed to unregister subscribers:', error);
  }
}
