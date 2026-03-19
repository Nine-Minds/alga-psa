export {
  dynamic as teamsBotAuthCallbackDynamic,
  GET as handleTeamsBotAuthCallbackGet,
} from '../app/api/teams/auth/callback/bot/route';
export {
  dynamic as teamsMessageExtensionAuthCallbackDynamic,
  GET as handleTeamsMessageExtensionAuthCallbackGet,
} from '../app/api/teams/auth/callback/message-extension/route';
export {
  dynamic as teamsTabAuthCallbackDynamic,
  GET as handleTeamsTabAuthCallbackGet,
} from '../app/api/teams/auth/callback/tab/route';
export {
  dynamic as teamsBotMessagesDynamic,
  POST as handleTeamsBotMessagesPost,
} from '../app/api/teams/bot/messages/route';
export {
  dynamic as teamsMessageExtensionQueryDynamic,
  POST as handleTeamsMessageExtensionQueryPost,
} from '../app/api/teams/message-extension/query/route';
export {
  dynamic as teamsPackageDynamic,
  GET as handleTeamsPackageGet,
  POST as handleTeamsPackagePost,
  OPTIONS as handleTeamsPackageOptions,
} from '../app/api/teams/package/route';
export {
  dynamic as teamsQuickActionsDynamic,
  POST as handleTeamsQuickActionsPost,
} from '../app/api/teams/quick-actions/route';
export { default as TeamsTabPage } from '../app/teams/tab/page';
