import type { EmulatorPackage } from '@alga-psa/emulator-host';
import { MsGraphCore } from './core';
import { register } from './register';
import { wire } from './wire';

const msgraphEmulator: EmulatorPackage<MsGraphCore> = {
  id: 'msgraph',
  displayName: 'Microsoft Graph',
  defaultPort: 4010,
  createCore: (env) => new MsGraphCore(env),
  wire,
  register,
};

export default msgraphEmulator;
export { msgraphEmulator as emulator };
export { GraphApiError, MsGraphCore } from './core';
export type {
  ActivityNotificationRecord,
  BotConfig,
  BotConversation,
  CapturedBotActivity,
  CapturedSendMail,
  GraphApplication,
  GraphChat,
  GraphChatMessage,
  GraphMessage,
  GraphServicePrincipal,
  GraphSubscription,
  GraphTeam,
  GraphTeamChannel,
  InboundBotActivityInput,
} from './core';
export { BOT_FRAMEWORK_ISSUER } from './botFramework';
