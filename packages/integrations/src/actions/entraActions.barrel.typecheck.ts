import {
  initiateEntraDirectOAuth,
  getEntraIntegrationStatus,
  connectEntraIntegration,
  startEntraSync,
  type EntraConnectionType,
  type EntraSyncScope,
} from './index';
import {
  initiateEntraDirectOAuth as directInitiateEntraDirectOAuth,
  getEntraIntegrationStatus as directGetEntraIntegrationStatus,
  connectEntraIntegration as directConnectEntraIntegration,
  startEntraSync as directStartEntraSync,
  type EntraConnectionType as DirectEntraConnectionType,
  type EntraSyncScope as DirectEntraSyncScope,
} from './integrations/entraActions';

const initiateFromBarrel: typeof directInitiateEntraDirectOAuth = initiateEntraDirectOAuth;
const statusFromBarrel: typeof directGetEntraIntegrationStatus = getEntraIntegrationStatus;
const connectFromBarrel: typeof directConnectEntraIntegration = connectEntraIntegration;
const syncFromBarrel: typeof directStartEntraSync = startEntraSync;

const connectionTypeValue: EntraConnectionType = 'direct';
const sameConnectionTypeValue: DirectEntraConnectionType = connectionTypeValue;

const syncScopeValue: EntraSyncScope = 'all-tenants';
const sameSyncScopeValue: DirectEntraSyncScope = syncScopeValue;

void initiateFromBarrel;
void statusFromBarrel;
void connectFromBarrel;
void syncFromBarrel;
void sameConnectionTypeValue;
void sameSyncScopeValue;
