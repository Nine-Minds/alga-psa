// Minimal mock for expo-notifications in Node test environment.
// Individual suites override behavior with vi.mock factories where needed.

export const AndroidImportance = { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 };
export const SchedulableTriggerInputTypes = { DATE: "date", TIME_INTERVAL: "timeInterval" };

export function setNotificationHandler(): void {}

export async function getPermissionsAsync() {
  return { status: "undetermined", granted: false };
}

export async function requestPermissionsAsync() {
  return { status: "undetermined", granted: false };
}

export async function getExpoPushTokenAsync() {
  return { data: "ExponentPushToken[test]" };
}

export async function setNotificationChannelAsync() {
  return null;
}

export async function scheduleNotificationAsync() {
  return "test-notification-id";
}

export async function cancelScheduledNotificationAsync(): Promise<void> {}

export async function getAllScheduledNotificationsAsync() {
  return [] as unknown[];
}

export async function getPresentedNotificationsAsync() {
  return [] as unknown[];
}

export async function dismissNotificationAsync(): Promise<void> {}

export function addNotificationReceivedListener() {
  return { remove: () => undefined };
}

export function addNotificationResponseReceivedListener() {
  return { remove: () => undefined };
}

export async function getLastNotificationResponseAsync() {
  return null;
}
