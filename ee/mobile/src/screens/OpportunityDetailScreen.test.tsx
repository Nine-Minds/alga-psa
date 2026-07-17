import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared UI primitives rely on the automatic JSX runtime and don't import React;
// the vitest transform uses the classic runtime, so expose React globally.
Object.assign(globalThis, { React });

const { getOpportunityMock, getTimelineMock, listContactsMock, recordPendingCallMock, showToastMock, translate, authValue } = vi.hoisted(() => ({
  getOpportunityMock: vi.fn(),
  getTimelineMock: vi.fn(),
  listContactsMock: vi.fn(),
  recordPendingCallMock: vi.fn(),
  showToastMock: vi.fn(),
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
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("../features/opportunities/hooks/usePendingCallPrompt", () => ({
  recordPendingCall: (...args: unknown[]) => recordPendingCallMock(...args),
  usePendingCallPrompt: () => ({ prompt: null, dismiss: () => undefined }),
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

vi.mock("../api/contacts", () => ({
  listContacts: (...args: unknown[]) => listContactsMock(...args),
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
      confidence: "high",
      mrr_cents: 123400,
      nrr_cents: 50000,
      currency_code: "USD",
      next_action: "Call the CTO",
      next_action_due: "2026-07-20T09:00:00Z",
      expected_close_date: "2026-08-31T00:00:00Z",
      owner_name: "Riley Owner",
      contact_id: "contact-1",
      contact_name: "Jane Doe",
      contact_phone: "+15551234567",
      contact_email: "jane@acme.com",
      linked_quotes: [
        { quote_id: "q1", quote_number: "Q-2041", status: "sent", total_amount: 250000, currency_code: "USD" },
      ],
    },
  },
};

const DEAL_NO_CONTACT = {
  ok: true,
  status: 200,
  data: {
    data: {
      ...DEAL.data.data,
      contact_id: null,
      contact_name: null,
      contact_phone: null,
      contact_email: null,
    },
  },
};

const CLIENT_CONTACTS = {
  ok: true,
  status: 200,
  data: {
    data: [
      { contact_name_id: "cc-1", full_name: "Pat Lee", email: "pat@acme.com", default_phone_number: "+15550001111" },
      { contact_name_id: "cc-2", full_name: "Sam Roe", email: null, default_phone_number: null },
    ],
    pagination: { page: 1, limit: 3, total: 5, totalPages: 2, hasNext: true, hasPrev: false },
  },
};

function findByTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.find((n) => n.props?.testID === testID);
}

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

  it("renders the deal facts and linked quotes", async () => {
    const renderer = await renderScreen();

    expect(hasText(renderer, "OPP-1")).toBe(true);
    expect(hasText(renderer, "Confidence")).toBe(true);
    expect(hasText(renderer, "high")).toBe(true);
    expect(hasText(renderer, "Expected close")).toBe(true);
    expect(hasText(renderer, "Riley Owner")).toBe(true);
    expect(hasText(renderer, "Q-2041")).toBe(true);
    expect(hasText(renderer, "$2,500")).toBe(true);
  });

  it("navigates to the client from the header", async () => {
    const renderer = await renderScreen();

    await act(async () => {
      findByTestId(renderer, "opportunity-detail-client-link").props.onPress();
    });

    expect((navigation as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledWith("ClientDetail", {
      clientId: "c1",
      clientName: "Acme",
    });
  });

  it("shows the linked contact's phone and email and dials on tap", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    const renderer = await renderScreen();

    // The rep sees the actual number and address, not just icons.
    expect(hasText(renderer, "+15551234567")).toBe(true);
    expect(hasText(renderer, "jane@acme.com")).toBe(true);

    await act(async () => {
      findByTestId(renderer, "opportunity-detail-call").props.onPress();
    });
    expect(openUrl).toHaveBeenCalledWith("tel:+15551234567");

    await act(async () => {
      findByTestId(renderer, "opportunity-detail-email").props.onPress();
    });
    expect(openUrl).toHaveBeenCalledWith("mailto:jane@acme.com");
    openUrl.mockRestore();
  });

  it("falls back to the client's contacts when no contact is linked", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    getOpportunityMock.mockResolvedValue(DEAL_NO_CONTACT);
    listContactsMock.mockResolvedValue(CLIENT_CONTACTS);
    const renderer = await renderScreen();

    // Contacts are fetched for the deal's client.
    expect(listContactsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ client_id: "c1", limit: 3 }),
    );
    expect(hasText(renderer, "Pat Lee")).toBe(true);
    expect(hasText(renderer, "Sam Roe")).toBe(true);
    expect(hasText(renderer, "View all (5)")).toBe(true);

    // Calling a fallback contact dials their default number.
    await act(async () => {
      findByTestId(renderer, "opportunity-detail-client-contact-call-cc-1").props.onPress();
    });
    expect(openUrl).toHaveBeenCalledWith("tel:+15550001111");

    // A contact with no phone or email gets no reach actions.
    expect(
      renderer.root.findAll((n) => n.props?.testID === "opportunity-detail-client-contact-call-cc-2"),
    ).toHaveLength(0);
    openUrl.mockRestore();
  });

  it("arms the call-log prompt only after the dialer opens", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    const renderer = await renderScreen();

    await act(async () => {
      findByTestId(renderer, "opportunity-detail-call").props.onPress();
    });
    await flush();

    expect(openUrl).toHaveBeenCalledWith("tel:+15551234567");
    expect(recordPendingCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityId: "opp-1", contactId: "contact-1", contactName: "Jane Doe" }),
    );
    openUrl.mockRestore();
  });

  it("does not arm the prompt when the device can't place calls", async () => {
    const { Linking } = await import("react-native");
    const openUrl = vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("unsupported"));
    const renderer = await renderScreen();

    await act(async () => {
      findByTestId(renderer, "opportunity-detail-call").props.onPress();
    });
    await flush();

    // A wifi-only iPad must not get a stray "log this call?" on the next resume.
    expect(recordPendingCallMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ tone: "error", message: "This device can't place phone calls." }),
    );
    openUrl.mockRestore();
  });

  it("shows the empty-contacts hint when the client has none", async () => {
    getOpportunityMock.mockResolvedValue(DEAL_NO_CONTACT);
    listContactsMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [], pagination: { page: 1, limit: 3, total: 0, totalPages: 0, hasNext: false, hasPrev: false } },
    });
    const renderer = await renderScreen();

    expect(hasText(renderer, "No contacts for this client yet.")).toBe(true);
  });
});
