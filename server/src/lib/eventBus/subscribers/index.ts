import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerSurveySubscriber, unregisterSurveySubscriber } from './surveySubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';
import { registerInternalNotificationSubscriber, unregisterInternalNotificationSubscriber } from './internalNotificationSubscriber';
import { registerSlaSubscriber, unregisterSlaSubscriber } from './slaSubscriber';
import { registerSlaNotificationSubscriber, unregisterSlaNotificationSubscriber } from './slaNotificationSubscriber';

type SubscriberRegistration = {
  name: string;
  register: () => Promise<void>;
};

const REGISTRATIONS: SubscriberRegistration[] = [
  { name: 'ticketEmail', register: registerTicketEmailSubscriber },
  { name: 'projectEmail', register: registerProjectEmailSubscriber },
  { name: 'survey', register: registerSurveySubscriber },
  { name: 'calendarSync', register: registerCalendarSyncSubscriber },
  { name: 'internalNotification', register: registerInternalNotificationSubscriber },
  { name: 'sla', register: registerSlaSubscriber },
  { name: 'slaNotification', register: registerSlaNotificationSubscriber },
];

const UNREGISTRATIONS: SubscriberRegistration[] = [
  { name: 'ticketEmail', register: unregisterTicketEmailSubscriber },
  { name: 'projectEmail', register: unregisterProjectEmailSubscriber },
  { name: 'survey', register: unregisterSurveySubscriber },
  { name: 'calendarSync', register: unregisterCalendarSyncSubscriber },
  { name: 'internalNotification', register: unregisterInternalNotificationSubscriber },
  { name: 'sla', register: unregisterSlaSubscriber },
  { name: 'slaNotification', register: unregisterSlaNotificationSubscriber },
];

// Each subscriber registers in its own try/catch. A transient failure (e.g. a
// Redis hiccup hitting the first one) must not silently skip every subscriber
// after it — that left production servers running for weeks with broken event
// handling and zero alarm bell.
export async function registerAllSubscribers(): Promise<void> {
  const failures: Array<{ name: string; error: unknown }> = [];

  for (const { name, register } of REGISTRATIONS) {
    try {
      await register();
    } catch (error) {
      failures.push({ name, error });
      console.error(`Failed to register subscriber "${name}":`, error);
    }
  }

  if (failures.length > 0) {
    console.error(
      `[Subscribers] ${failures.length}/${REGISTRATIONS.length} subscriber registrations failed:`,
      failures.map((f) => f.name).join(', ')
    );
  }
}

export async function unregisterAllSubscribers(): Promise<void> {
  for (const { name, register: unregister } of UNREGISTRATIONS) {
    try {
      await unregister();
    } catch (error) {
      console.error(`Failed to unregister subscriber "${name}":`, error);
    }
  }
}
