import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T098: a push payload routes to the screen its ids name — ticket and task as
 * before, and now the project (when no task is named) and the asset.
 */

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openURL: vi.fn(),
  responseListener: null as ((response: unknown) => void) | null,
  lastResponse: null as unknown,
}));

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    mocks.responseListener = listener;
    return { remove: vi.fn() };
  },
  addNotificationReceivedListener: () => ({ remove: vi.fn() }),
  getLastNotificationResponseAsync: async () => mocks.lastResponse,
  getPermissionsAsync: async () => ({ status: "granted" }),
  requestPermissionsAsync: async () => ({ status: "granted" }),
  getExpoPushTokenAsync: async () => ({ data: "token" }),
  setNotificationChannelAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  getAllScheduledNotificationsAsync: async () => [],
  setBadgeCountAsync: vi.fn(),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, LOW: 2 },
}));

vi.mock("expo-linking", () => ({
  createURL: () => "exp://test/",
  openURL: (...args: unknown[]) => mocks.openURL(...args),
  parse: () => ({ scheme: "alga", hostname: "", path: "" }),
  getInitialURL: vi.fn(async () => null),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
}));

const { navigateFromNotificationForTest } = await import("./notificationRouting");

const navigation = { navigate: mocks.navigate } as never;
const lookup = async () => null;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("navigateFromNotification", () => {
  it("routes a ticket payload to the ticket", async () => {
    await navigateFromNotificationForTest({ ticketId: "t-1" }, navigation, lookup);
    expect(mocks.navigate).toHaveBeenCalledWith("TicketDetail", { ticketId: "t-1" });
  });

  it("routes a task payload to the task even when a project rides along", async () => {
    await navigateFromNotificationForTest({ taskId: "task-1", projectId: "p-1" }, navigation, lookup);
    expect(mocks.navigate).toHaveBeenCalledWith("ProjectTaskDetail", { taskId: "task-1" });
  });

  it("routes a project-only payload to the project", async () => {
    await navigateFromNotificationForTest({ projectId: "p-1" }, navigation, lookup);
    expect(mocks.navigate).toHaveBeenCalledWith("ProjectDetail", { projectId: "p-1" });
  });

  it("routes an asset payload to the asset", async () => {
    await navigateFromNotificationForTest({ assetId: "a-1" }, navigation, lookup);
    expect(mocks.navigate).toHaveBeenCalledWith("AssetDetail", { assetId: "a-1" });
  });

  it("navigates nowhere for an empty payload", async () => {
    await navigateFromNotificationForTest(undefined, navigation, lookup);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
