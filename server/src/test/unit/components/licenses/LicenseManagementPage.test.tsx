// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import LicenseManagementPage from "@/components/licenses/LicenseManagementPage";
import {
  getLicenseStatus,
  startTrial,
} from "@/lib/actions/licenseManagementActions";
import type { LicenseStatus } from "@/lib/actions/licenseManagementActions";

const mockUpdateSession = vi.fn();
const mockRouterRefresh = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => ({ update: mockUpdateSession }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("@/lib/actions/licenseManagementActions", () => ({
  getLicenseStatus: vi.fn(),
  submitLicense: vi.fn(),
  startTrial: vi.fn(),
  connectAppliance: vi.fn(),
}));

const mockGetLicenseStatus = vi.mocked(getLicenseStatus);
const mockStartTrial = vi.mocked(startTrial);

const baseStatus: LicenseStatus = {
  selfHostMode: true,
  state: "trial_available",
  tier: "essentials",
  expiresAt: null,
  daysRemaining: null,
  customer: null,
  trialUsed: false,
  connected: false,
  lastCheckinAt: null,
  tenantId: "tenant-1",
  subscription: null,
};

beforeEach(() => {
  mockUpdateSession.mockResolvedValue(undefined);
  mockGetLicenseStatus.mockResolvedValue(baseStatus);
  mockStartTrial.mockResolvedValue({
    success: true,
    status: {
      ...baseStatus,
      state: "trial",
      tier: "pro",
      daysRemaining: 15,
      expiresAt: "2026-06-30T00:00:00.000Z",
      trialUsed: true,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LicenseManagementPage", () => {
  it("renders the Essentials trial CTA first and hides meaningless connection copy", async () => {
    render(<LicenseManagementPage />);

    expect(
      await screen.findByRole("heading", { name: "You’re running Essentials" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start 15-day Pro trial/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Have a license code or key?")).toBeInTheDocument();

    const advanced = screen
      .getByText("Have a license code or key?")
      .closest("details");
    expect(advanced).not.toHaveAttribute("open");

    // The offline-keys helper is the only air-gapped mention and stays inside
    // the collapsed advanced section, not in the primary flow.
    const offlineHelper = screen.getByText(/air-gapped installs/i);
    expect(offlineHelper.closest("details")).toBe(advanced);
    expect(
      screen.queryByText(/Connect this appliance/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("License refresh")).not.toBeInTheDocument();
  });

  it("waits for the session tier refresh before showing trial success", async () => {
    let resolveSessionUpdate: () => void = () => undefined;
    mockUpdateSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSessionUpdate = () => resolve(undefined);
      }),
    );

    render(<LicenseManagementPage />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Start 15-day Pro trial/i,
      }),
    );

    await waitFor(() => expect(mockStartTrial).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockUpdateSession).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", {
        name: "Your Pro trial is active",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("15-day Pro trial started."),
    ).not.toBeInTheDocument();

    resolveSessionUpdate();

    expect(
      await screen.findByRole("heading", {
        name: "Your Pro trial is active",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("15-day Pro trial started."),
    ).toBeInTheDocument();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });

  it("only shows automatic license refresh status when the appliance has connected license credentials", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "pro",
      connected: true,
      lastCheckinAt: "2026-06-15T12:30:00.000Z",
      expiresAt: "2026-07-15T00:00:00.000Z",
      trialUsed: true,
      customer: "Nine Minds Test Co",
    });

    render(<LicenseManagementPage />);

    expect(
      await screen.findByRole("heading", { name: "Pro is active" }),
    ).toBeInTheDocument();
    expect(screen.getByText("License refresh")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start 15-day Pro trial/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the pre-lapse section with the end date, resubscribe link and refresh button", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "pro",
      customer: "Acme",
      connected: true,
      expiresAt: "2030-01-31T00:00:00.000Z",
      daysRemaining: 20,
      subscription: {
        phase: "ending",
        cause: "cancelled",
        endsAt: "2030-01-31T12:00:00.000Z",
        resubscribeUrl: "https://portal.example/resubscribe",
      },
    });

    render(<LicenseManagementPage />);

    expect(
      await screen.findByText("Your Pro subscription has been cancelled."),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Pro ends on /)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Resubscribe/ }).getAttribute("href"),
    ).toBe("https://portal.example/resubscribe");
    expect(
      document.getElementById("license-lapse-refresh-now"),
    ).toBeInTheDocument();
  });

  it("words a fixed-term grant end as 'Pro ends on', never as a cancellation", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "pro",
      connected: true,
      expiresAt: "2030-01-31T00:00:00.000Z",
      daysRemaining: 20,
      subscription: { phase: "ending", cause: "term", endsAt: "2030-01-31T12:00:00.000Z", resubscribeUrl: null },
    });

    render(<LicenseManagementPage />);

    expect(await screen.findByText("Your Pro term is ending.")).toBeInTheDocument();
    expect(screen.getByText(/^Pro ends on /)).toBeInTheDocument();
    expect(screen.queryByText(/has been cancelled/)).not.toBeInTheDocument();
  });

  it("shows the free-edition message after the lapse, without 'contact support'", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "license_expired",
      tier: "essentials",
      trialUsed: true,
      subscription: { phase: "lapsed", cause: "cancelled", endsAt: "2025-07-12T00:00:00.000Z", resubscribeUrl: null },
    });

    render(<LicenseManagementPage />);

    expect(
      await screen.findByText(
        "You’re now on the free edition. Resubscribe to restore Pro.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Pro ended on /)).toBeInTheDocument();
    expect(screen.queryByText(/contact support/i)).not.toBeInTheDocument();
  });

  it("shows a failing renewal payment with the retry date and an update-payment link", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "pro",
      subscription: {
        phase: "payment_failed",
        cause: "payment_failed",
        endsAt: null,
        resubscribeUrl: null,
        nextRetryAt: "2030-01-05T12:00:00.000Z",
        updatePaymentUrl: "https://pay.example/i/1",
      },
    });

    render(<LicenseManagementPage />);

    expect(await screen.findByText(/^Payment failed — we’ll retry on .*2030\. Update your payment method to keep Pro\.$/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Update payment method/ }).getAttribute("href"),
    ).toBe("https://pay.example/i/1");
    expect(screen.queryByText(/Nothing is deleted/)).not.toBeInTheDocument();
  });

  it("shows a failing renewal payment without a retry date using date-free wording", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "pro",
      subscription: {
        phase: "payment_failed",
        cause: "payment_failed",
        endsAt: null,
        resubscribeUrl: null,
        nextRetryAt: null,
        updatePaymentUrl: "https://pay.example/i/1",
      },
    });

    render(<LicenseManagementPage />);

    expect(
      await screen.findByText("Payment failed. Update your payment method to keep Pro."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/we’ll retry on/)).not.toBeInTheDocument();
  });

  it("explains a Pro end that followed failed payments", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "license_expired",
      tier: "essentials",
      trialUsed: true,
      subscription: { phase: "lapsed", cause: "payment_failed", endsAt: "2025-07-12T00:00:00.000Z", resubscribeUrl: null },
    });

    render(<LicenseManagementPage />);

    expect(
      await screen.findByText("Pro ended — payment failed. Your appliance runs Essentials."),
    ).toBeInTheDocument();
  });

  it("shows no lapse section when the subscription is healthy", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "pro",
      customer: "Acme",
      expiresAt: "2030-01-31T00:00:00.000Z",
      daysRemaining: 20,
    });

    render(<LicenseManagementPage />);

    await screen.findByText("Pro is active");
    expect(screen.queryByText(/Resubscribe/)).not.toBeInTheDocument();
  });
});
