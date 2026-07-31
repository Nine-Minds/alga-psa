import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { getWorkQueueMock, listOpportunitiesMock, translate } = vi.hoisted(() => ({
  getWorkQueueMock: vi.fn(),
  listOpportunitiesMock: vi.fn(),
  // Stable identity across renders (matches production react-i18next).
  translate: (_key: string, def?: string, opts?: Record<string, unknown>) => {
    let out = def ?? _key;
    if (opts) {
      for (const [key, value] of Object.entries(opts)) {
        out = out.replaceAll(`{{${key}}}`, String(value));
      }
    }
    return out;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

// Provide a FlatList that actually renders its header/items/empty so the pipeline
// list can be asserted (the shared RN test mock omits FlatList).
vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const ReactLocal = await import("react");
  const FlatList = (props: Record<string, any>) => {
    const data: unknown[] = props.data ?? [];
    const children: React.ReactNode[] = [];
    if (props.ListHeaderComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "header" }, props.ListHeaderComponent));
    }
    if (data.length === 0 && props.ListEmptyComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "empty" }, props.ListEmptyComponent));
    } else {
      data.forEach((item, index) => {
        const key = props.keyExtractor ? props.keyExtractor(item, index) : String(index);
        children.push(ReactLocal.createElement(ReactLocal.Fragment, { key }, props.renderItem({ item, index })));
      });
    }
    if (props.ListFooterComponent) {
      children.push(ReactLocal.createElement(ReactLocal.Fragment, { key: "footer" }, props.ListFooterComponent));
    }
    return ReactLocal.createElement("FlatList", { testID: props.testID }, children);
  };
  return { ...actual, FlatList };
});

vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});

const mockNavigate = vi.fn();
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: vi.fn(),
  }),
}));

vi.mock("../config/appConfig", () => ({
  getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }),
}));

vi.mock("../api", () => ({
  createApiClient: () => ({ request: vi.fn() }),
}));

vi.mock("../api/opportunities", () => ({
  getWorkQueue: (...args: unknown[]) => getWorkQueueMock(...args),
  listOpportunities: (...args: unknown[]) => listOpportunitiesMock(...args),
}));

vi.mock("../logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { OpportunitiesScreen } from "./OpportunitiesScreen";

const navigation = { navigate: mockNavigate } as never;

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(OpportunitiesScreen, { navigation } as never));
  });
  await flush();
  return renderer;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function textContent(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAll((n) => String(n.type) === "Text").map((n) => {
    const value = n.props.children;
    return Array.isArray(value) ? value.join("") : String(value);
  });
}

function hasText(renderer: ReactTestRenderer, text: string): boolean {
  return textContent(renderer).includes(text);
}

function byTestId(renderer: ReactTestRenderer, testID: string): ReactTestInstance | undefined {
  return renderer.root.findAll((n) => n.props.testID === testID)[0];
}

function press(renderer: ReactTestRenderer, testID: string) {
  const node = byTestId(renderer, testID);
  if (!node) throw new Error(`testID "${testID}" not found`);
  act(() => node.props.onPress());
}

const QUEUE_FIXTURE = {
  ok: true,
  status: 200,
  data: {
    data: {
      sections: [
        {
          key: "due_today",
          title: "Do these today",
          items: [
            {
              opportunity_id: "opp-1",
              title: "Acme renewal",
              client_name: "Acme",
              next_action: "Call the CTO",
              next_action_due: "2026-07-20T09:00:00Z",
              overdue: true,
              why: { text: "Stalled 12 days after the demo", emphasis: "Stalled 12 days" },
            },
          ],
        },
        {
          key: "going_quiet",
          items: [{ opportunity_id: "opp-2", title: "Globex upgrade", client_name: "Globex", why: "No touch in a week" }],
        },
      ],
    },
  },
};

const PIPELINE_FIXTURE = {
  ok: true,
  status: 200,
  data: {
    data: [
      {
        opportunity_id: "opp-1",
        opportunity_number: "OPP-1",
        title: "Acme renewal",
        client_id: "c1",
        client_name: "Acme",
        status: "open",
        stage: "qualified",
        mrr_cents: 123400,
        currency_code: "USD",
        days_since_activity: 10,
      },
      {
        opportunity_id: "opp-2",
        opportunity_number: "OPP-2",
        title: "Globex upgrade",
        client_id: "c2",
        client_name: "Globex",
        status: "open",
        stage: "proposed",
      },
    ],
    pagination: { page: 1, limit: 25, total: 2, totalPages: 1, hasNext: false, hasPrev: false },
  },
};

describe("OpportunitiesScreen queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkQueueMock.mockResolvedValue(QUEUE_FIXTURE);
    listOpportunitiesMock.mockResolvedValue(PIPELINE_FIXTURE);
  });

  it("renders queue sections with the why-sentence and navigates on row tap", async () => {
    const renderer = await renderScreen();

    expect(hasText(renderer, "Do these today")).toBe(true);
    expect(hasText(renderer, "Going quiet")).toBe(true); // mapped from the going_quiet key
    expect(hasText(renderer, "Call the CTO")).toBe(true);

    // Why sentence rendered, with the emphasis substring in its own (bold) node.
    expect(byTestId(renderer, "opportunity-why-opp-1")).toBeDefined();
    expect(hasText(renderer, "Stalled 12 days")).toBe(true);

    press(renderer, "opportunity-row-opp-1");
    expect(mockNavigate).toHaveBeenCalledWith("OpportunityDetail", {
      opportunityId: "opp-1",
      title: "Acme renewal",
    });
  });

  it("shows the finished empty state when nothing is due", async () => {
    getWorkQueueMock.mockResolvedValue({ ok: true, status: 200, data: { data: { sections: [] } } });
    const renderer = await renderScreen();

    expect(hasText(renderer, "That's everything. Nothing needs you today.")).toBe(true);
  });
});

describe("OpportunitiesScreen pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkQueueMock.mockResolvedValue({ ok: true, status: 200, data: { data: { sections: [] } } });
    listOpportunitiesMock.mockResolvedValue(PIPELINE_FIXTURE);
  });

  it("renders stage badges and MRR/quiet lines", async () => {
    const renderer = await renderScreen();
    press(renderer, "opportunities-segment-pipeline");
    await flush();
    await flush();

    // Stage labels come from i18n in production; the test's translate mock returns
    // the fallback (the raw stage), which still proves a StageBadge rendered per row.
    expect(hasText(renderer, "qualified")).toBe(true);
    expect(hasText(renderer, "proposed")).toBe(true);
    expect(hasText(renderer, "$1,234/mo")).toBe(true);
    expect(hasText(renderer, "10 days quiet")).toBe(true);
  });

  it("debounces search before refetching", async () => {
    vi.useFakeTimers();
    try {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(React.createElement(OpportunitiesScreen, { navigation } as never));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      press(renderer, "opportunities-segment-pipeline");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });

      listOpportunitiesMock.mockClear();
      const search = byTestId(renderer, "opportunities-pipeline-search");
      act(() => search?.props.onChangeText("glob"));

      // Not yet — debounce is still pending.
      expect(listOpportunitiesMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 50);
      });

      expect(listOpportunitiesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ search: "glob", status: "open" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

const SEARCH_DEBOUNCE_MS = 300;
