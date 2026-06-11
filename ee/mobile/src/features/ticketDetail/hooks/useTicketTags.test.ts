import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";
import { useTicketTags } from "./useTicketTags";
import type { ApiClient } from "../../../api/client";
import type { TicketTag } from "../../../api/tags";

// --- Mocks -----------------------------------------------------------------

vi.mock("../../../device/clientMetadata", () => ({
  getClientMetadataHeaders: vi.fn().mockResolvedValue({ "x-device": "test" }),
}));

vi.mock("../../../api/tags", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/tags")>();
  return {
    ...original,
    getTicketTags: vi.fn(),
    addTicketTag: vi.fn(),
    removeTicketTag: vi.fn(),
  };
});

import { addTicketTag, getTicketTags, removeTicketTag } from "../../../api/tags";
const mockGetTags = getTicketTags as ReturnType<typeof vi.fn>;
const mockAddTag = addTicketTag as ReturnType<typeof vi.fn>;
const mockRemoveTag = removeTicketTag as ReturnType<typeof vi.fn>;

// --- Helpers ---------------------------------------------------------------

const fakeClient = { request: vi.fn() } as unknown as ApiClient;
const fakeSession = {
  accessToken: "tok-123",
  refreshToken: "ref",
  expiresAtMs: Date.now() + 60_000,
  user: { id: "user-1" },
};

function tag(id: string, text: string, over: Partial<TicketTag> = {}): TicketTag {
  return { tag_id: id, tag_text: text, tagged_id: "t-1", tagged_type: "ticket", ...over };
}

function tagsResponse(tags: TicketTag[]) {
  return {
    ok: true,
    status: 200,
    data: { data: { entity_id: "t-1", entity_type: "ticket", tags, total_tags: tags.length } },
  };
}

type HookReturn = ReturnType<typeof useTicketTags>;

async function renderHook() {
  const t = (key: string) => key;
  const latest: { current: HookReturn } = { current: undefined as unknown as HookReturn };

  function Wrapper() {
    const hook = useTicketTags({
      client: fakeClient,
      session: fakeSession,
      ticketId: "t-1",
      t,
      showToast: vi.fn(),
    });
    latest.current = hook;
    return null;
  }

  await act(async () => {
    create(React.createElement(Wrapper));
  });

  return { latest };
}

// --- Tests -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTicketTags", () => {
  it("loads tags on mount", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([tag("m1", "vip")]));

    const { latest } = await renderHook();

    expect(mockGetTags).toHaveBeenCalledWith(fakeClient, { apiKey: "tok-123", ticketId: "t-1" });
    expect(latest.current.tags).toEqual([tag("m1", "vip")]);
    expect(latest.current.tagsLoading).toBe(false);
    expect(latest.current.tagsHidden).toBe(false);
  });

  it("hides the section when listing tags is forbidden", async () => {
    mockGetTags.mockResolvedValue({ ok: false, error: { kind: "permission" } });

    const { latest } = await renderHook();

    expect(latest.current.tagsHidden).toBe(true);
    expect(latest.current.tagsError).toBeNull();
  });

  it("sets a load error for non-permission failures", async () => {
    mockGetTags.mockResolvedValue({ ok: false, error: { kind: "server" } });

    const { latest } = await renderHook();

    expect(latest.current.tagsHidden).toBe(false);
    expect(latest.current.tagsError).toBe("tags.errors.load");
  });

  it("addTag posts the trimmed text and appends the created tags", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([tag("m1", "vip")]));
    mockAddTag.mockResolvedValue({
      ok: true,
      status: 201,
      data: { data: { tags: [tag("m2", "urgent")], created_count: 1 } },
    });

    const { latest } = await renderHook();

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.addTag("  urgent ");
    });

    expect(result).toBe(true);
    expect(mockAddTag).toHaveBeenCalledWith(fakeClient, {
      apiKey: "tok-123",
      ticketId: "t-1",
      tagText: "urgent",
      auditHeaders: { "x-device": "test" },
    });
    expect(latest.current.tags.map((item) => item.tag_text)).toEqual(["vip", "urgent"]);
  });

  it("addTag is a no-op for an already applied tag (case-insensitive)", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([tag("m1", "VIP")]));

    const { latest } = await renderHook();

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.addTag("vip");
    });

    expect(result).toBe(true);
    expect(mockAddTag).not.toHaveBeenCalled();
  });

  it("addTag sets a permission error on 403", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([]));
    mockAddTag.mockResolvedValue({ ok: false, error: { kind: "permission" } });

    const { latest } = await renderHook();

    let result: boolean | undefined;
    await act(async () => {
      result = await latest.current.addTag("vip");
    });

    expect(result).toBe(false);
    expect(latest.current.tagActionError).toBe("tags.errors.addPermission");
  });

  it("removeTag removes optimistically and keeps the removal on success", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([tag("m1", "vip"), tag("m2", "urgent")]));
    mockRemoveTag.mockResolvedValue({ ok: true, status: 200, data: { data: { removed_count: 1 } } });

    const { latest } = await renderHook();

    await act(async () => {
      await latest.current.removeTag(tag("m1", "vip"));
    });

    expect(mockRemoveTag).toHaveBeenCalledWith(fakeClient, {
      apiKey: "tok-123",
      ticketId: "t-1",
      tagId: "m1",
      auditHeaders: { "x-device": "test" },
    });
    expect(latest.current.tags.map((item) => item.tag_id)).toEqual(["m2"]);
  });

  it("removeTag rolls back and sets an error on failure", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([tag("m1", "vip")]));
    mockRemoveTag.mockResolvedValue({ ok: false, error: { kind: "server" } });

    const { latest } = await renderHook();

    await act(async () => {
      await latest.current.removeTag(tag("m1", "vip"));
    });

    expect(latest.current.tags.map((item) => item.tag_id)).toEqual(["m1"]);
    expect(latest.current.tagActionError).toBe("tags.errors.removeGeneric");
  });

  it("selectTag closes the picker only when adding succeeds", async () => {
    mockGetTags.mockResolvedValue(tagsResponse([]));
    mockAddTag.mockResolvedValue({ ok: false, error: { kind: "server" } });

    const { latest } = await renderHook();

    act(() => latest.current.openTagPicker());
    expect(latest.current.tagPickerOpen).toBe(true);

    await act(async () => {
      await latest.current.selectTag("vip");
    });
    expect(latest.current.tagPickerOpen).toBe(true);

    mockAddTag.mockResolvedValue({
      ok: true,
      status: 201,
      data: { data: { tags: [tag("m1", "vip")], created_count: 1 } },
    });
    await act(async () => {
      await latest.current.selectTag("vip");
    });
    expect(latest.current.tagPickerOpen).toBe(false);
  });
});
