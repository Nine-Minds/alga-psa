import { registerTicketActions } from './businessOperations/tickets';
import { registerClientActions } from './businessOperations/clients';
import { registerContactActions } from './businessOperations/contacts';
import { registerEmailActions } from './businessOperations/email';
import { registerNotificationActions } from './businessOperations/notifications';
import { registerSchedulingActions } from './businessOperations/scheduling';
import { registerProjectActions } from './businessOperations/projects';
import { registerTimeActions } from './businessOperations/time';
import { registerCrmActions } from './businessOperations/crm';

export function registerBusinessOperationsActionsV2(): void {
  registerTicketActions();
  registerClientActions();
  registerContactActions();
  registerEmailActions();
  registerNotificationActions();
  registerSchedulingActions();
  registerProjectActions();
  registerTimeActions();
  registerCrmActions();
}
