// Minimal mock for expo-localization in Node test environment.

export function getLocales() {
  return [{ languageTag: "en-US", languageCode: "en", isRTL: false }];
}

export function getCalendars() {
  return [{ calendar: "gregory", timeZone: "America/New_York", uses24hourClock: false }];
}
