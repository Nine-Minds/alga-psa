// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractBillingTrace } from "@alga-psa/types";

vi.mock("@alga-psa/ui/lib/i18n/client", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => {
      let value = String(options?.defaultValue ?? _key);
      for (const [name, replacement] of Object.entries(options ?? {})) {
        if (name !== "defaultValue") value = value.replaceAll(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  }),
}));

import BillingTermsSection from "@alga-psa/billing/components/billing-dashboard/contracts/BillingTermsSection";

const trace: ContractBillingTrace = {
  asOf: "2026-10-22",
  profiles: [
    {
      billingProfileId: "p-1",
      name: "Entity B",
      source: "contract",
      lineCount: 3,
      isActive: true,
      isDefault: false,
      terms: {
        value: "net_15",
        source: "profile",
        days: 15,
        dueDateExample: { invoiceDate: "2026-10-22", dueDate: "2026-11-06" },
      },
      fields: [],
    },
  ],
  terms: {
    value: "net_15",
    source: "profile",
    days: 15,
    dueDateExample: { invoiceDate: "2026-10-22", dueDate: "2026-11-06" },
  },
  fields: [],
  warnings: [],
};

afterEach(cleanup);

describe("simulator billing identity header", () => {
  it("renders the billing profile name and payment terms", () => {
    render(<BillingTermsSection trace={trace} variant="simulation" />);
    expect(screen.getByTestId("billing-profile-name")).toHaveTextContent("Entity B");
    expect(screen.getByTestId("billing-terms-value")).toBeInTheDocument();
    expect(screen.getByTestId("billing-due-sentence")).toHaveTextContent("2026-11-06");
  });

  it("does not claim per-profile tax exemption fidelity", () => {
    render(<BillingTermsSection trace={trace} variant="simulation" />);
    expect(screen.getByTestId("billing-terms-section")).toHaveTextContent(
      /client-level tax exemption/i,
    );
  });
});
