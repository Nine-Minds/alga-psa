// @vitest-environment jsdom
/** T032 / T036: the appliance license page shows the service-principal usage row ("N of M" on Pro, "Available on Pro" below). */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import LicenseManagementPage from "@/components/licenses/LicenseManagementPage";
import { getLicenseStatus } from "@/lib/actions/licenseManagementActions";
import type { LicenseStatus } from "@/lib/actions/licenseManagementActions";

const spUsage = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/licenseManagementActions", () => ({
  getLicenseStatus: vi.fn(),
  submitLicense: vi.fn(),
  startTrial: vi.fn(),
  connectAppliance: vi.fn(),
}));
// CE builds resolve @enterprise to a render-nothing stub; render the real EE row for this test.
vi.mock("@enterprise/components/service-principals/ServicePrincipalUsageRow", () => import("../../../../../../ee/server/src/components/service-principals/ServicePrincipalUsageRow"));
vi.mock("@ee/lib/actions/service-principal-actions", () => ({ getServicePrincipalUsage: spUsage }));

const status = (tier: string): LicenseStatus => ({
  selfHostMode: true,
  state: "active",
  tier,
  expiresAt: null,
  daysRemaining: null,
  customer: "Acme MSP",
  trialUsed: true,
  connected: false,
  lastCheckinAt: null,
  tenantId: "tenant-1",
});

beforeEach(() => spUsage.mockResolvedValue({ limit: 10, used: 4, remaining: 6 }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LicenseManagementPage service principal usage row", () => {
  it('reads "4 of 10" on Pro', async () => {
    vi.mocked(getLicenseStatus).mockResolvedValue(status("pro"));
    render(<LicenseManagementPage />);
    const row = await screen.findByTestId("service-principal-usage-row");
    await waitFor(() => expect(row.textContent).toContain("4 of 10"));
  });

  it('reads "Available on Pro" below Pro', async () => {
    vi.mocked(getLicenseStatus).mockResolvedValue(status("essentials"));
    spUsage.mockClear();
    render(<LicenseManagementPage />);
    const row = await screen.findByTestId("service-principal-usage-row");
    expect(row.textContent).toContain("Available on Pro");
    expect(spUsage).not.toHaveBeenCalled();
  });
});
