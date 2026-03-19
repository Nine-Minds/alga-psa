export {
  dynamic as googleCalendarOAuthCallbackDynamic,
  GET as handleGoogleCalendarOAuthCallbackGet,
} from '../app/api/auth/google/calendar/callback/route';
export {
  dynamic as microsoftCalendarOAuthCallbackDynamic,
  GET as handleMicrosoftCalendarOAuthCallbackGet,
} from '../app/api/auth/microsoft/calendar/callback/route';
export {
  GET as handleGoogleCalendarWebhookGet,
  POST as handleGoogleCalendarWebhookPost,
  OPTIONS as handleGoogleCalendarWebhookOptions,
} from '../app/api/calendar/webhooks/google/route';
export {
  GET as handleMicrosoftCalendarWebhookGet,
  POST as handleMicrosoftCalendarWebhookPost,
  OPTIONS as handleMicrosoftCalendarWebhookOptions,
} from '../app/api/calendar/webhooks/microsoft/route';
