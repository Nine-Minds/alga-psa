import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';
import { registerInternalNotificationSubscriber, unregisterInternalNotificationSubscriber } from './internalNotificationSubscriber';

export async function registerAllSubscribers(): Promise<void> {
  try {
    await registerTicketEmailSubscriber();
    await registerProjectEmailSubscriber();
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
    await unregisterCalendarSyncSubscriber();
    await unregisterInternalNotificationSubscriber();
  } catch (error) {
    console.error('Failed to unregister subscribers:', error);
  }
}
