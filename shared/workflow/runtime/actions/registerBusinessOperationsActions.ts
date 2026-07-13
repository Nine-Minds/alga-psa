import { registerTicketActions } from './businessOperations/tickets';
import { registerClientActions } from './businessOperations/clients';
import { registerContactActions } from './businessOperations/contacts';
import { registerEmailActions } from './businessOperations/email';
import { registerNotificationActions } from './businessOperations/notifications';
import { registerSchedulingActions } from './businessOperations/scheduling';
import { registerProjectActions } from './businessOperations/projects';
import { registerTimeActions } from './businessOperations/time';
import { registerCrmActions } from './businessOperations/crm';
import { registerAssetActions } from './businessOperations/assets';
import { registerDataStoreActions } from './businessOperations/dataStore';
import { registerEntityLinkActions } from './businessOperations/entityLinks';
import { registerActivityActions } from './businessOperations/activities';
import { registerOpportunityActions } from './businessOperations/opportunities';

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
  registerAssetActions();
  registerDataStoreActions();
  registerEntityLinkActions();
  registerActivityActions();
  registerOpportunityActions();
}
