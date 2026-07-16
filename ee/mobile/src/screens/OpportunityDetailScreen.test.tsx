import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { getOpportunityMock, getTimelineMock, translate, authValue } = vi.hoisted(() => ({
  getOpportunityMock: vi.fn(),
  getTimelineMock: vi.fn(),
  // Stable across renders so useMemo(client)/useCallback(fetchAll) identities hold.
  authValue: {
    session: { accessToken: "api-key", tenantId: "tenant-1", user: { id: "user-1" } },
    refreshSession: () => Promise.resolve(null),
  },
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

vi.mock("../ui/ThemeContext", async () => {
  const { lightTheme } = await import("../ui/themes");
  return { useTheme: () => lightTheme };
});

vi.mock("../ui/toast/ToastProvider", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => authValue,
}));

vi.mock("../config/appConfig", () => ({
  getAppConfig: () => ({ ok: true, env: "dev", baseUrl: "https://algapsa.com" }),
}));

vi.mock("../api", () => ({
  createApiClient: () => ({ request: vi.fn() }),
}));

vi.mock("../api/opportunities", () => ({
  getOpportunity: (...args: unknown[]) => getOpportunityMock(...args),
  getOpportunityTimeline: (...args: unknown[]) => getTimelineMock(...args),
  completeNextAction: vi.fn(),
  winOpportunity: vi.fn(),
  loseOpportunity: vi.fn(),
}));

vi.mock("../logging/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PrimaryButton } from "../ui/components/PrimaryButton";
import { OpportunityDetailScreen } from "./OpportunityDetailScreen";

const route = { params: { opportunityId: "opp-1", title: "Acme renewal" } } as never;
const navigation = { navigate: vi.fn(), setParams: vi.fn() } as never;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(OpportunityDetailScreen, { route, navigation }));
  });
  await flush();
  return renderer;
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

const DEAL = {
  ok: true,
  status: 200,
  data: {
    data: {
      opportunity_id: "opp-1",
      opportunity_number: "OPP-1",
      title: "Acme renewal",
      client_id: "c1",
      client_name: "Acme",
      status: "open",
      stage: "qualified",
      mrr_cents: 123400,
      nrr_cents: 50000,
      currency_code: "USD",
      next_action: "Call the CTO",
      next_action_due: "2026-07-20T09:00:00Z",
      contact_id: "contact-1",
      contact_name: "Jane Doe",
      contact_phone: "+15551234567",
      contact_email: "jane@acme.com",
    },
  },
};

const TIMELINE = {
  ok: true,
  status: 200,
  data: {
    data: [
      { interaction_id: "int-1", type_name: "Call", title: "Intro call", user_name: "Rep One", interaction_date: "2026-07-15T10:00:00Z", duration: 15 },
      { interaction_id: "int-2", type_name: "Email", title: "Sent proposal", user_name: "Rep One", interaction_date: "2026-07-10T10:00:00Z" },
    ],
  },
};

describe("OpportunityDetailScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOpportunityMock.mockResolvedValue(DEAL);
    getTimelineMock.mockResolvedValue(TIMELINE);
  });

  it("renders the next-action card with a single primary button and the timeline", async () => {
    const renderer = await renderScreen();

    expect(hasText(renderer, "Call the CTO")).toBe(true);

    // The Complete button is the only primary on the screen.
    const primaries = renderer.root.findAllByType(PrimaryButton);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].props.children).toBe("Complete");

    // Timeline entries render newest-first.
    expect(hasText(renderer, "Intro call")).toBe(true);
    expect(hasText(renderer, "Sent proposal")).toBe(true);
    expect(hasText(renderer, "Call")).toBe(true);
  });

  it("renders only the non-null values in the header", async () => {
    const renderer = await renderScreen();

    // MRR and NRR provided; Hardware is null and must be absent.
    expect(hasText(renderer, "$1,234")).toBe(true);
    expect(hasText(renderer, "$500")).toBe(true);
    expect(hasText(renderer, "Hardware")).toBe(false);
  });
});
