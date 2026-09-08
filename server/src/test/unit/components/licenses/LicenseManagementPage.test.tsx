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
  submitLicense,
} from "@/lib/actions/licenseManagementActions";
import type { LicenseStatus } from "@/lib/actions/licenseManagementActions";

const mockUpdateSession = vi.fn();
const mockRouterRefresh = vi.fn();
const release = vi.hoisted(() => ({ enabled: true }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: release.enabled }) }));
vi.mock('@/lib/actions/coManagedAcceptanceActions', () => ({}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata: () => {}, updateActions: () => {} }),
}));

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
  release.enabled = true;
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

it('uses tenant key activation without appliance trials or connection controls', async () => {
  const status: LicenseStatus = { ...baseStatus, scope: 'tenant', state: 'license_required' };
  mockGetLicenseStatus.mockResolvedValue(status);
  vi.mocked(submitLicense).mockResolvedValue({ success: true, status: { ...status, state: 'licensed', tier: 'pro' } });
  render(<LicenseManagementPage />);
  expect(await screen.findByRole('heading', { name: 'coManaged.tenantLicense.title' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Start 15-day Pro trial/ })).not.toBeInTheDocument();
  expect(document.querySelector('#license-claim-code')).toBeNull();
  fireEvent.change(screen.getByLabelText('coManaged.tenantLicense.key'), { target: { value: '  signed-tenant-key  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.tenantLicense.activate' }));
  await waitFor(() => expect(submitLicense).toHaveBeenCalledWith('signed-tenant-key'));
  expect(await screen.findByText('Workspace license key activated.')).toBeInTheDocument();
  expect(screen.getByLabelText('coManaged.tenantLicense.key')).toHaveValue('');
});

it('hides tenant license controls while the UI release flag is disabled', async () => {
  release.enabled = false;
  mockGetLicenseStatus.mockResolvedValue({ ...baseStatus, scope: 'tenant', state: 'license_required' });
  render(<LicenseManagementPage />);
  await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull());
  expect(screen.queryByLabelText('coManaged.tenantLicense.key')).not.toBeInTheDocument();
  expect(document.querySelector('#license-claim-code')).toBeNull();
});

it('keeps the tenant key for correction and shows a safe error when activation is denied', async () => {
  mockGetLicenseStatus.mockResolvedValue({ ...baseStatus, scope: 'tenant', state: 'license_required' });
  vi.mocked(submitLicense).mockRejectedValue(new Error('Internal database detail must not be displayed'));
  render(<LicenseManagementPage />);
  fireEvent.change(await screen.findByLabelText('coManaged.tenantLicense.key'), { target: { value: 'invalid-key' } });
  fireEvent.click(screen.getByRole('button', { name: 'coManaged.tenantLicense.activate' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to activate license key.');
  expect(screen.getByLabelText('coManaged.tenantLicense.key')).toHaveValue('invalid-key');
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
});
