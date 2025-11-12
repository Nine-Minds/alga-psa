import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerSurveySubscriber, unregisterSurveySubscriber } from './surveySubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';

export async function registerAllSubscribers(): Promise<void> {
  try {
    await registerTicketEmailSubscriber();
    await registerProjectEmailSubscriber();
    await registerSurveySubscriber();
    await registerCalendarSyncSubscriber();
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
  } catch (error) {
    console.error('Failed to unregister subscribers:', error);
  }
}
