export const MOBILE_ANALYTICS_SCHEMA_VERSION = "1.0.0" as const;

export const MobileAnalyticsEvents = {
  apiRequestSucceeded: "api.request.succeeded",
  apiRequestFailed: "api.request.failed",

  appStartupReady: "app.startup.ready",

  authCallbackFailed: "auth.callback.failed",
  authExchangeFailed: "auth.exchange.failed",
  authExchangeSucceeded: "auth.exchange.succeeded",
  authLogout: "auth.logout",
  authRefreshFailed: "auth.refresh.failed",
  authRefreshRevoked: "auth.refresh.revoked",
  authRefreshSucceeded: "auth.refresh.succeeded",
  authSignInBlocked: "auth.sign_in.blocked",
  authSignInOpenFailed: "auth.sign_in.open_failed",
  authSignInOpenedBrowser: "auth.sign_in.opened_browser",
  authSignInStart: "auth.sign_in.start",
} as const;

export type MobileAnalyticsEventName =
  (typeof MobileAnalyticsEvents)[keyof typeof MobileAnalyticsEvents];

export const MobileAnalyticsScreens = {
  signIn: "SignIn",
  authCallback: "AuthCallback",
  ticketsList: "TicketsList",
  ticketDetail: "TicketDetail",
  settings: "Settings",
} as const;

export type MobileAnalyticsScreenName =
  (typeof MobileAnalyticsScreens)[keyof typeof MobileAnalyticsScreens];
