import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Linking } from "react-native";
import type { TicketComment, TicketDetail } from "../api/tickets";

const {
  addTicketCommentMock,
  getTicketByIdMock,
  getTicketCommentsMock,
  getTicketPrioritiesMock,
  getTicketStatusesMock,
  updateTicketAssignmentMock,
  updateTicketAttributesMock,
  updateTicketPriorityMock,
  updateTicketStatusMock,
  getSecureJsonMock,
  setSecureJsonMock,
  deleteItemMock,
  createApiClientMock,
  showToastMock,
  storageState,
} = vi.hoisted(() => ({
  addTicketCommentMock: vi.fn(),
  getTicketByIdMock: vi.fn(),
  getTicketCommentsMock: vi.fn(),
  getTicketPrioritiesMock: vi.fn(),
  getTicketStatusesMock: vi.fn(),
  updateTicketAssignmentMock: vi.fn(),
  updateTicketAttributesMock: vi.fn(),
  updateTicketPriorityMock: vi.fn(),
  updateTicketStatusMock: vi.fn(),
  getSecureJsonMock: vi.fn(),
  setSecureJsonMock: vi.fn(),
  deleteItemMock: vi.fn(),
  createApiClientMock: vi.fn(),
  showToastMock: vi.fn(),
  storageState: new Map<string, unknown>(),
}));

function parseEditorContent(content: string | null | undefined): unknown {
  if (!content) {
    return [];
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return [
      {
        type: "paragraph",
        content: [{ type: "text", text: content, styles: {} }],
      },
    ];
  }
}

vi.mock("../config/appConfig", () => ({
  getAppConfig: () => ({
    ok: true,
    baseUrl: "https://example.com",
  }),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session: null,
    refreshSession: () => undefined,
  }),
}));

vi.mock("../api", () => ({
  createApiClient: (...args: unknown[]) => createApiClientMock(...args),
}));

vi.mock("../api/tickets", () => ({
  addTicketComment: (...args: unknown[]) => addTicketCommentMock(...args),
  getTicketById: (...args: unknown[]) => getTicketByIdMock(...args),
  getTicketComments: (...args: unknown[]) => getTicketCommentsMock(...args),
  getTicketPriorities: (...args: unknown[]) => getTicketPrioritiesMock(...args),
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
  updateTicketAssignment: (...args: unknown[]) => updateTicketAssignmentMock(...args),
  updateTicketAttributes: (...args: unknown[]) => updateTicketAttributesMock(...args),
  updateTicketPriority: (...args: unknown[]) => updateTicketPriorityMock(...args),
  updateTicketStatus: (...args: unknown[]) => updateTicketStatusMock(...args),
}));

vi.mock("../hooks/usePullToRefresh", () => ({
  usePullToRefresh: () => ({
    refreshing: false,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("../cache/ticketsCache", () => ({
  getCachedTicketDetail: () => ({
    ticket_id: "ticket-1",
    ticket_number: "T-1",
    title: "Example ticket",
    status_name: "Open",
    status_is_closed: false,
    attributes: {
      description:
        "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Original description\",\"styles\":{}}]}]",
    },
  }),
  invalidateTicketsListCache: () => undefined,
  setCachedTicketDetail: () => undefined,
}));

vi.mock("../cache/referenceDataCache", () => ({
  getCachedTicketStatuses: () => null,
  setCachedTicketStatuses: () => undefined,
}));

vi.mock("../storage/secureStorage", () => ({
  getSecureJson: (key: string) => getSecureJsonMock(key),
  secureStorage: {
    deleteItem: (key: string) => deleteItemMock(key),
  },
  setSecureJson: (key: string, value: unknown) => setSecureJsonMock(key, value),
}));

vi.mock("../device/clientMetadata", () => ({
  getClientMetadataHeaders: async () => ({}),
}));

vi.mock("../api/timeEntries", () => ({
  createTimeEntry: vi.fn(),
}));

vi.mock("../network/useNetworkStatus", () => ({
  useNetworkStatus: () => ({}),
}));

vi.mock("../network/isOffline", () => ({
  isOffline: () => false,
}));

vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({
    showToast: (...args: unknown[]) => showToastMock(...args),
  }),
}));

vi.mock("../ui/formatters/dateTime", () => ({
  formatDateTimeWithRelative: () => "just now",
}));

vi.mock("../clipboard/clipboard", () => ({
  copyToClipboard: async () => ({
    copiedText: "copied",
  }),
}));

vi.mock("../urls/hostedUrls", () => ({
  buildTicketWebUrl: () => "https://example.com/ticket/1",
}));

vi.mock("../ui/components/Badge", () => ({
  Badge: (props: Record<string, unknown>) => React.createElement("MockBadge", props),
}));

vi.mock("../ui/components/DatePickerField", () => ({
  DatePickerField: (props: Record<string, unknown>) => React.createElement("MockDatePickerField", props),
}));

vi.mock("../ui/components/TimePickerField", () => ({
  TimePickerField: (props: Record<string, unknown>) => React.createElement("MockTimePickerField", props),
}));

vi.mock("../ui/components/PrimaryButton", () => ({
  PrimaryButton: (props: Record<string, unknown>) =>
    React.createElement("MockPrimaryButton", props, props.children as React.ReactNode),
}));

vi.mock("../features/ticketRichText/TicketRichTextEditor", async () => {
  const React = await import("react");

  const TicketRichTextEditor = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
    const parsedContent = React.useMemo(
      () => parseEditorContent(props.content as string | null | undefined),
      [props.content],
    );

    React.useImperativeHandle(ref, () => ({
      focus: () => undefined,
      blur: () => undefined,
      setContent: () => undefined,
      setEditable: () => undefined,
      getHTML: async () => "",
      getJSON: async () => parsedContent,
      runCommand: () => undefined,
    }), [parsedContent]);

    return React.createElement("MockRichTextEditor", props);
  });

  return {
    TicketRichTextEditor,
  };
});

import { TicketDetailBody } from "./TicketDetailScreen";

const baseTicket: TicketDetail = {
  ticket_id: "ticket-1",
  ticket_number: "T-1",
  title: "Example ticket",
  status_name: "Open",
  status_is_closed: false,
  attributes: {
    description:
      "[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Original description\",\"styles\":{}}]}]",
  },
};

const updatedDescriptionJson = [
  {
    type: "paragraph",
    content: [{ type: "text", text: "Updated description", styles: {} }],
  },
];

const richCommentJson = [
  {
    type: "paragraph",
    content: [{ type: "text", text: "Rich mobile comment", styles: {} }],
  },
];

const baseSession = {
  tenantId: "tenant-1",
  accessToken: "token-1",
  refreshToken: "refresh-1",
  expiresAtMs: Date.now() + 60_000,
  user: {
    id: "user-1",
    name: "Alice",
    email: "alice@example.com",
  },
};

function createSuccessResult<T>(data: T) {
  return Promise.resolve({
    ok: true as const,
    data: { data },
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderBody(
  props: Partial<React.ComponentProps<typeof TicketDetailBody>> = {},
): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;

  act(() => {
    renderer = create(
      React.createElement(TicketDetailBody, {
        ticketId: "ticket-1",
        config: {
          ok: true,
          env: "dev",
          baseUrl: "https://example.com",
        },
        session: baseSession,
        refreshSession: async () => null,
        qaScenario: undefined,
        ...props,
      }),
    );
  });

  if (!renderer) {
    throw new Error("Renderer was not created");
  }

  return renderer;
}

function findRichTextEditor(
  renderer: ReactTestRenderer,
  loadingLabel: string,
): { props: Record<string, unknown> } {
  return renderer.root.find(
    (node) =>
      (node.type as string) === "MockRichTextEditor"
      && node.props.loadingLabel === loadingLabel,
  ) as { props: Record<string, unknown> };
}

function pressControl(renderer: ReactTestRenderer, label: string): void {
  const control = renderer.root.find(
    (node) =>
      ((node.type as string) === "Pressable" || (node.type as string) === "MockPrimaryButton")
      && node.props.accessibilityLabel === label,
  );

  act(() => {
    control.props.onPress();
  });
}

describe("TicketDetailScreen rich text behavior flows", () => {
  beforeEach(() => {
    storageState.clear();
    addTicketCommentMock.mockReset();
    getTicketByIdMock.mockReset();
    getTicketCommentsMock.mockReset();
    getTicketPrioritiesMock.mockReset();
    getTicketStatusesMock.mockReset();
    updateTicketAssignmentMock.mockReset();
    updateTicketAttributesMock.mockReset();
    updateTicketPriorityMock.mockReset();
    updateTicketStatusMock.mockReset();
    getSecureJsonMock.mockReset();
    setSecureJsonMock.mockReset();
    deleteItemMock.mockReset();
    createApiClientMock.mockReset();
    showToastMock.mockReset();

    createApiClientMock.mockReturnValue({ request: vi.fn() });
    getTicketByIdMock.mockImplementation(() => createSuccessResult(baseTicket));
    getTicketCommentsMock.mockImplementation(() => createSuccessResult([] as TicketComment[]));
    getSecureJsonMock.mockImplementation(async (key: string) => storageState.get(key) ?? null);
    setSecureJsonMock.mockImplementation(async (key: string, value: unknown) => {
      storageState.set(key, value);
    });
    deleteItemMock.mockImplementation(async (key: string) => {
      storageState.delete(key);
    });
    addTicketCommentMock.mockImplementation(async (_client: unknown, params: Record<string, unknown>) =>
      createSuccessResult({
        comment_id: "comment-2",
        comment_text: params.comment_text as string,
        is_internal: params.is_internal as boolean,
        created_by_name: "Alice",
        created_at: "2026-03-11T00:00:00.000Z",
      } satisfies TicketComment)
    );
    updateTicketAttributesMock.mockImplementation(async (_client: unknown, params: Record<string, unknown>) =>
      createSuccessResult({
        ...baseTicket,
        attributes: params.attributes as Record<string, unknown> | null,
      } satisfies TicketDetail)
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists edited description content through the ticket attribute update path", async () => {
    const renderer = renderBody();
    await flushAsyncWork();

    pressControl(renderer, "Edit description");

    const descriptionEditor = findRichTextEditor(renderer, "Loading description editor…");
    await act(async () => {
      (descriptionEditor.props.onContentChange as ((payload: { json: unknown }) => void) | undefined)?.({
        json: updatedDescriptionJson,
      });
    });

    pressControl(renderer, "Save");
    await flushAsyncWork();

    expect(updateTicketAttributesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ticketId: "ticket-1",
        attributes: expect.objectContaining({
          description: JSON.stringify(updatedDescriptionJson),
        }),
      }),
    );
  });

  it("cancels description editing without persisting changes", async () => {
    const renderer = renderBody();
    await flushAsyncWork();

    pressControl(renderer, "Edit description");

    const descriptionEditor = findRichTextEditor(renderer, "Loading description editor…");
    await act(async () => {
      (descriptionEditor.props.onContentChange as ((payload: { json: unknown }) => void) | undefined)?.({
        json: updatedDescriptionJson,
      });
    });

    pressControl(renderer, "Cancel");
    await flushAsyncWork();

    expect(updateTicketAttributesMock).not.toHaveBeenCalled();
    const readOnlyDescription = findRichTextEditor(renderer, "Loading description…");
    expect(readOnlyDescription.props.content).toBe(baseTicket.attributes?.description);
  });

  it("upgrades legacy plain-text descriptions to serialized rich-text content on save", async () => {
    getTicketByIdMock.mockImplementation(() =>
      createSuccessResult({
        ...baseTicket,
        attributes: {
          description: "Legacy plain description",
        },
      } satisfies TicketDetail)
    );

    const renderer = renderBody();
    await flushAsyncWork();

    pressControl(renderer, "Edit description");

    const descriptionEditor = findRichTextEditor(renderer, "Loading description editor…");
    expect(descriptionEditor.props.content).toBe("Legacy plain description");

    await act(async () => {
      (descriptionEditor.props.onContentChange as ((payload: { json: unknown }) => void) | undefined)?.({
        json: updatedDescriptionJson,
      });
    });

    pressControl(renderer, "Save");
    await flushAsyncWork();

    expect(updateTicketAttributesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attributes: expect.objectContaining({
          description: JSON.stringify(updatedDescriptionJson),
        }),
      }),
    );
  });

  it("keeps unsent rich-comment drafts across reloads for the same user and ticket", async () => {
    const renderer = renderBody();
    await flushAsyncWork();

    const commentEditor = findRichTextEditor(renderer, "Loading comment editor…");
    await act(async () => {
      (commentEditor.props.onContentChange as ((payload: { json: unknown }) => void) | undefined)?.({
        json: richCommentJson,
      });
    });
    await flushAsyncWork();

    expect(setSecureJsonMock).toHaveBeenCalledWith(
      "alga.mobile.ticketDraft.user-1.ticket-1",
      {
        text: JSON.stringify(richCommentJson),
        isInternal: true,
      },
    );

    act(() => {
      renderer.unmount();
    });

    const reloadedRenderer = renderBody();
    await flushAsyncWork();

    const reloadedCommentEditor = findRichTextEditor(reloadedRenderer, "Loading comment editor…");
    expect(reloadedCommentEditor.props.content).toBe(JSON.stringify(richCommentJson));
  });

  it("submits new rich comments through the existing comment creation flow", async () => {
    const renderer = renderBody();
    await flushAsyncWork();

    const commentEditor = findRichTextEditor(renderer, "Loading comment editor…");
    await act(async () => {
      (commentEditor.props.onContentChange as ((payload: { json: unknown }) => void) | undefined)?.({
        json: richCommentJson,
      });
    });
    await flushAsyncWork();

    pressControl(renderer, "Send comment");
    await flushAsyncWork();

    expect(addTicketCommentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ticketId: "ticket-1",
        comment_text: JSON.stringify(richCommentJson),
        is_internal: true,
      }),
    );
    expect(deleteItemMock).toHaveBeenCalledWith("alga.mobile.ticketDraft.user-1.ticket-1");
  });

  it("can run the dev QA smoke scenario through description save, comment send, and link handoff", async () => {
    vi.useFakeTimers();
    const openUrlSpy = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);

    try {
      const renderer = renderBody({ qaScenario: "richtext-smoke" });
      await flushAsyncWork();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
        await Promise.resolve();
        await Promise.resolve();
      });

      const readOnlyDescription = findRichTextEditor(renderer, "Loading description…");
      expect(readOnlyDescription.props.qaAutoPressFirstLink).toBe(true);
      expect(updateTicketAttributesMock).toHaveBeenCalledTimes(1);
      expect(addTicketCommentMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        (readOnlyDescription.props.onLinkPress as ((url: string) => void) | undefined)?.(
          "https://example.com/mobile-rich-text-smoke",
        );
      });
      await flushAsyncWork();

      expect(openUrlSpy).toHaveBeenCalledWith("https://example.com/mobile-rich-text-smoke");
      expect(
        renderer.root.findAll(
          (node) =>
            (node.type as string) === "Text" &&
            String(Array.isArray(node.props.children) ? node.props.children.join("") : node.props.children).includes(
              "PASSED - Triggered rich-text link handoff",
            ),
        ),
      ).toHaveLength(1);
    } finally {
      openUrlSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
