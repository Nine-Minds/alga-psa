import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";

// --- Mocks -----------------------------------------------------------------

const sessionRef = {
  current: {
    accessToken: "session-token-aaaaaaaaaaaaaaaaaaaa",
    refreshToken: "ref",
    expiresAtMs: Date.now() + 60_000,
    tenantId: "tenant-1",
    user: { id: "user-1" },
  } as { accessToken: string; refreshToken: string; expiresAtMs: number; tenantId?: string; user?: { id: string } } | null,
};

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    session: sessionRef.current,
    setSession: vi.fn(),
    refreshSession: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("../../config/appConfig", () => ({
  getAppConfig: () => ({ ok: true, baseUrl: "https://app.example.com", env: "dev" }),
}));

vi.mock("../../api", () => ({
  createApiClient: vi.fn(() => ({ request: vi.fn() })),
}));

const listMutedUsersMock = vi.fn();
const muteUserMock = vi.fn();
const unmuteUserMock = vi.fn();
const reportContentMock = vi.fn();

vi.mock("../../api/moderation", () => ({
  listMutedUsers: (...args: unknown[]) => listMutedUsersMock(...args),
  muteUser: (...args: unknown[]) => muteUserMock(...args),
  unmuteUser: (...args: unknown[]) => unmuteUserMock(...args),
  reportContent: (...args: unknown[]) => reportContentMock(...args),
}));

// --- Helpers ---------------------------------------------------------------

type HookReturn = ReturnType<typeof import("./useModeration").useModeration>;

function renderHook() {
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };

  // Defer the hook import until after mocks are registered so each test can
  // bust the module-level cache by resetting modules in beforeEach.
  return import("./useModeration").then(({ useModeration }) => {
    function Wrapper() {
      latest.current = useModeration();
      return null;
    }
    let tree: ReturnType<typeof create> | null = null;
    act(() => {
      tree = create(React.createElement(Wrapper));
    });
    return {
      latest,
      rerender: () => {
        act(() => {
          tree?.update(React.createElement(Wrapper));
        });
      },
    };
  });
}

beforeEach(() => {
  // Wipe the module-level cache between tests so they don't leak.
  vi.resetModules();
  listMutedUsersMock.mockReset();
  muteUserMock.mockReset();
  unmuteUserMock.mockReset();
  reportContentMock.mockReset();
  sessionRef.current = {
    accessToken: "session-token-aaaaaaaaaaaaaaaaaaaa",
    refreshToken: "ref",
    expiresAtMs: Date.now() + 60_000,
    tenantId: "tenant-1",
    user: { id: "user-1" },
  };
});

afterEach(() => {
  vi.resetModules();
});

// --- Tests -----------------------------------------------------------------

describe("useModeration", () => {
  it("hydrates the mute set from the server on mount", async () => {
    listMutedUsersMock.mockResolvedValue({
      ok: true,
      data: { mutedUserIds: ["aaa", "bbb"] },
    });

    const { latest, rerender } = await renderHook();

    // Allow the fetch promise to resolve and the cache notifier to fire.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    expect(listMutedUsersMock).toHaveBeenCalledTimes(1);
    expect(latest.current.isMuted("aaa")).toBe(true);
    expect(latest.current.isMuted("bbb")).toBe(true);
    expect(latest.current.isMuted("ccc")).toBe(false);
    expect(latest.current.isMuted(null)).toBe(false);
    expect(latest.current.isMuted(undefined)).toBe(false);
  });

  it("starts with an empty set when the server fetch fails", async () => {
    listMutedUsersMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "down" },
    });

    const { latest, rerender } = await renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    expect(latest.current.mutedUserIds.size).toBe(0);
    expect(latest.current.isMuted("aaa")).toBe(false);
  });

  it("mute() optimistically updates the cache and persists on success", async () => {
    listMutedUsersMock.mockResolvedValue({ ok: true, data: { mutedUserIds: [] } });
    muteUserMock.mockResolvedValue({ ok: true, data: { ok: true } });

    const { latest, rerender } = await renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.mute("user-2");
    });
    rerender();

    expect(result).toBe(true);
    expect(muteUserMock).toHaveBeenCalledWith(expect.anything(), { mutedUserId: "user-2" });
    expect(latest.current.isMuted("user-2")).toBe(true);
  });

  it("mute() rolls back the optimistic update when the server rejects", async () => {
    listMutedUsersMock.mockResolvedValue({ ok: true, data: { mutedUserIds: [] } });
    muteUserMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { kind: "server", message: "boom" },
    });

    const { latest, rerender } = await renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.mute("user-2");
    });
    rerender();

    expect(result).toBe(false);
    expect(latest.current.isMuted("user-2")).toBe(false);
  });

  it("unmute() optimistically removes from the cache and persists on success", async () => {
    listMutedUsersMock.mockResolvedValue({ ok: true, data: { mutedUserIds: ["user-2"] } });
    unmuteUserMock.mockResolvedValue({ ok: true, data: { ok: true } });

    const { latest, rerender } = await renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();
    expect(latest.current.isMuted("user-2")).toBe(true);

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.unmute("user-2");
    });
    rerender();

    expect(result).toBe(true);
    expect(unmuteUserMock).toHaveBeenCalledWith(expect.anything(), "user-2");
    expect(latest.current.isMuted("user-2")).toBe(false);
  });

  it("unmute() rolls back when the server rejects", async () => {
    listMutedUsersMock.mockResolvedValue({ ok: true, data: { mutedUserIds: ["user-2"] } });
    unmuteUserMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { kind: "server", message: "boom" },
    });

    const { latest, rerender } = await renderHook();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.unmute("user-2");
    });
    rerender();

    expect(result).toBe(false);
    expect(latest.current.isMuted("user-2")).toBe(true);
  });

  it("report() forwards the body to the API and returns the ok flag", async () => {
    listMutedUsersMock.mockResolvedValue({ ok: true, data: { mutedUserIds: [] } });
    reportContentMock.mockResolvedValue({ ok: true, data: { ok: true } });

    const { latest } = await renderHook();
    await act(async () => {
      await Promise.resolve();
    });

    let okFlag: boolean | undefined;
    await act(async () => {
      okFlag = await latest.current.report({
        contentType: "ticket_comment",
        contentId: "comment-1",
        contentAuthorUserId: "11111111-2222-3333-4444-555555555555",
      });
    });

    expect(okFlag).toBe(true);
    expect(reportContentMock).toHaveBeenCalledWith(expect.anything(), {
      contentType: "ticket_comment",
      contentId: "comment-1",
      contentAuthorUserId: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("report() returns false on server failure without throwing", async () => {
    listMutedUsersMock.mockResolvedValue({ ok: true, data: { mutedUserIds: [] } });
    reportContentMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: { kind: "server", message: "boom" },
    });

    const { latest } = await renderHook();
    await act(async () => {
      await Promise.resolve();
    });

    let okFlag: boolean | undefined;
    await act(async () => {
      okFlag = await latest.current.report({ contentType: "ticket_comment" });
    });

    expect(okFlag).toBe(false);
  });

  it("returns an empty set and skips the fetch when there is no session", async () => {
    sessionRef.current = null;

    const { latest } = await renderHook();
    await act(async () => {
      await Promise.resolve();
    });

    expect(listMutedUsersMock).not.toHaveBeenCalled();
    expect(latest.current.mutedUserIds.size).toBe(0);
  });
});
