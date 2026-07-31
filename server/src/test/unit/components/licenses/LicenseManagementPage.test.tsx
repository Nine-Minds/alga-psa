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
};

beforeEach(() => {
  mockUpdateSession.mockResolvedValue(undefined);
  mockGetLicenseStatus.mockResolvedValue(baseStatus);
  mockStartTrial.mockResolvedValue({
    success: true,
    status: {
      ...baseStatus,
      state: "trial",
      tier: "premium",
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
      screen.getByRole("button", { name: /Start 15-day Enterprise trial/i }),
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
        name: /Start 15-day Enterprise trial/i,
      }),
    );

    await waitFor(() => expect(mockStartTrial).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockUpdateSession).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", {
        name: "Your Enterprise trial is active",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("15-day Enterprise trial started."),
    ).not.toBeInTheDocument();

    resolveSessionUpdate();

    expect(
      await screen.findByRole("heading", {
        name: "Your Enterprise trial is active",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("15-day Enterprise trial started."),
    ).toBeInTheDocument();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
  });

  it("only shows automatic license refresh status when the appliance has connected license credentials", async () => {
    mockGetLicenseStatus.mockResolvedValue({
      ...baseStatus,
      state: "licensed",
      tier: "premium",
      connected: true,
      lastCheckinAt: "2026-06-15T12:30:00.000Z",
      expiresAt: "2026-07-15T00:00:00.000Z",
      trialUsed: true,
      customer: "Nine Minds Test Co",
    });

    render(<LicenseManagementPage />);

    expect(
      await screen.findByRole("heading", { name: "Premium is active" }),
    ).toBeInTheDocument();
    expect(screen.getByText("License refresh")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start 15-day Enterprise trial/i }),
    ).not.toBeInTheDocument();
  });
});
