import { registerTicketEmailSubscriber, unregisterTicketEmailSubscriber } from './ticketEmailSubscriber';
import { registerProjectEmailSubscriber, unregisterProjectEmailSubscriber } from './projectEmailSubscriber';
import { registerSurveySubscriber, unregisterSurveySubscriber } from './surveySubscriber';
import { registerCalendarSyncSubscriber, unregisterCalendarSyncSubscriber } from './calendarSyncSubscriber';
import { registerInternalNotificationSubscriber, unregisterInternalNotificationSubscriber } from './internalNotificationSubscriber';
import { registerSlaSubscriber, unregisterSlaSubscriber } from './slaSubscriber';
import { registerSlaNotificationSubscriber, unregisterSlaNotificationSubscriber } from './slaNotificationSubscriber';
import { registerCreditExpiringSubscriber, unregisterCreditExpiringSubscriber } from './creditExpiringSubscriber';
import { registerTicketAutoCloseWarningSubscriber, unregisterTicketAutoCloseWarningSubscriber } from './ticketAutoCloseWarningSubscriber';
import { registerWebhookSubscriber, unregisterWebhookSubscriber } from './webhookSubscriber';
import { registerSearchIndexSubscriber, unregisterSearchIndexSubscriber } from './searchIndexSubscriber';
import { registerInventoryNotificationSubscriber, unregisterInventoryNotificationSubscriber } from './inventoryNotificationSubscriber';
import { registerProjectWebhookSubscriber, unregisterProjectWebhookSubscriber } from './projectWebhookSubscriber';
import { registerRmmAlertTicketClosedSubscriber, unregisterRmmAlertTicketClosedSubscriber } from './rmmAlertTicketClosedSubscriber';
import { registerRmmAlertNotificationSubscriber, unregisterRmmAlertNotificationSubscriber } from './rmmAlertNotificationSubscriber';
import { registerMaintenanceJobSubscriber, unregisterMaintenanceJobSubscriber } from './maintenanceJobSubscriber';
import {
  registerProjectBillingPaymentStatusSubscriber,
  unregisterProjectBillingPaymentStatusSubscriber,
} from './projectBillingPaymentStatusSubscriber';

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
  { name: 'creditExpiring', register: registerCreditExpiringSubscriber },
  { name: 'ticketAutoCloseWarning', register: registerTicketAutoCloseWarningSubscriber },
  { name: 'webhook', register: registerWebhookSubscriber },
  { name: 'searchIndex', register: registerSearchIndexSubscriber },
  { name: 'inventoryNotification', register: registerInventoryNotificationSubscriber },
  { name: 'projectWebhook', register: registerProjectWebhookSubscriber },
  { name: 'rmmAlertTicketClosed', register: registerRmmAlertTicketClosedSubscriber },
  { name: 'rmmAlertNotification', register: registerRmmAlertNotificationSubscriber },
  { name: 'maintenanceJob', register: registerMaintenanceJobSubscriber },
  { name: 'projectBillingPaymentStatus', register: registerProjectBillingPaymentStatusSubscriber },
];

const UNREGISTRATIONS: SubscriberRegistration[] = [
  { name: 'ticketEmail', register: unregisterTicketEmailSubscriber },
  { name: 'projectEmail', register: unregisterProjectEmailSubscriber },
  { name: 'survey', register: unregisterSurveySubscriber },
  { name: 'calendarSync', register: unregisterCalendarSyncSubscriber },
  { name: 'internalNotification', register: unregisterInternalNotificationSubscriber },
  { name: 'sla', register: unregisterSlaSubscriber },
  { name: 'slaNotification', register: unregisterSlaNotificationSubscriber },
  { name: 'creditExpiring', register: unregisterCreditExpiringSubscriber },
  { name: 'ticketAutoCloseWarning', register: unregisterTicketAutoCloseWarningSubscriber },
  { name: 'maintenanceJob', register: unregisterMaintenanceJobSubscriber },
  { name: 'webhook', register: unregisterWebhookSubscriber },
  { name: 'searchIndex', register: unregisterSearchIndexSubscriber },
  { name: 'inventoryNotification', register: unregisterInventoryNotificationSubscriber },
  { name: 'projectWebhook', register: unregisterProjectWebhookSubscriber },
  { name: 'rmmAlertTicketClosed', register: unregisterRmmAlertTicketClosedSubscriber },
  { name: 'rmmAlertNotification', register: unregisterRmmAlertNotificationSubscriber },
  { name: 'projectBillingPaymentStatus', register: unregisterProjectBillingPaymentStatusSubscriber },
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
