import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { LevelEmulatorCore } from './core';
import { register } from './register';
import { wire } from './wire';

const levelioEmulator: EmulatorPackage<LevelEmulatorCore> = {
  id: 'levelio',
  displayName: 'Level',
  defaultPort: 4080,
  createCore: (env) => new LevelEmulatorCore(env),
  wire,
  register,
};

export default levelioEmulator;
export { levelioEmulator as emulator };
export { LevelEmulatorCore, LevelWireError, levelGid, LEVEL_EVENT_TYPES, LEVEL_SEVERITIES } from './core';
export {
  deliverEvent,
  flushDueRetries,
  onAlertActive,
  onAlertResolved,
  rerunDelivery,
  runAutomation,
  signLevelPayload,
} from './dispatcher';
export { renderTemplate, systemVariables, SYSTEM_VARIABLE_NAMES, formatMemory } from './variables';
export type {
  AutomationRunRecord,
  HttpRequestAction,
  LevelAlert,
  LevelAutomation,
  LevelDevice,
  LevelEventType,
  LevelGroup,
  LevelSeverity,
  LevelUpdate,
  LevelWebhookEndpoint,
  LevelWebhookEvent,
  WebhookDeliveryRecord,
} from './core';
export { retargetScenario } from './scenarios';
