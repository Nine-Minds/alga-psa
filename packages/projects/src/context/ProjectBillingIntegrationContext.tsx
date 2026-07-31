'use client';

import React, { createContext, useContext } from 'react';
import type { IProjectPhase, ProjectBillingOverview } from '@alga-psa/types';
import type {
  ActionMessageErrorShape,
  ActionPermissionErrorShape,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * Cross-feature slot for project billing.
 *
 * projects is a vertical feature package and must not import billing (ESLint
 * `no-feature-to-feature-imports`; it also closes an nx dependency cycle). The
 * billing surfaces that appear inside project screens — the Billing view, the
 * ambient billed bar, and the payment-prerequisite warning — are therefore
 * injected from the composition layer (msp-composition), which imports both
 * packages and wires billing's implementations into this context.
 *
 * When no provider is mounted (e.g. client portal, tests) the context is null
 * and every project-billing surface stays hidden.
 */

export type ProjectBillingOverviewResult =
  | ProjectBillingOverview
  | ActionMessageErrorShape
  | ActionPermissionErrorShape;

export interface ProjectBillingViewProps {
  projectId: string;
  clientId: string | null;
  phases: IProjectPhase[];
  overview: ProjectBillingOverview | null;
  loading: boolean;
  canManage: boolean;
  highlightEntryId: string | null;
  onChanged: () => void;
}

export interface ProjectPaymentWarningBannerProps {
  projectId: string;
  className?: string;
}

export interface ProjectBilledBarProps {
  invoicedCents: number;
  readyCents: number;
  approvedCents: number;
  /** Contract total for fixed price; billed target (cap or billed) for T&M. */
  totalCents: number | null;
  currency: string | null;
}

export interface SeparateProjectProductInvoiceReviewRow {
  project_material_id: string;
  service_id: string;
  service_name: string;
  description: string | null;
  quantity: number;
  rate: number;
  currency_code: string;
  total: number;
}

export interface SeparateProjectProductInvoiceReview {
  project_id: string;
  client_id: string;
  rows: SeparateProjectProductInvoiceReviewRow[];
}

export type SeparateProjectProductInvoiceReviewResult =
  | SeparateProjectProductInvoiceReview
  | ActionMessageErrorShape
  | ActionPermissionErrorShape;

export type CreateSeparateProjectProductInvoicesResult =
  | { invoices: Array<{ invoice_id: string; currency_code: string; product_count: number }> }
  | ActionMessageErrorShape
  | ActionPermissionErrorShape;

export interface ProjectBillingIntegrationContextType {
  fetchOverview: (projectId: string) => Promise<ProjectBillingOverviewResult>;
  getSeparateProjectProductInvoiceReview: (
    projectId: string,
  ) => Promise<SeparateProjectProductInvoiceReviewResult>;
  createSeparateProjectProductInvoices: (
    projectId: string,
    selectedMaterialIds: string[],
  ) => Promise<CreateSeparateProjectProductInvoicesResult>;
  BillingView: React.ComponentType<ProjectBillingViewProps>;
  PaymentWarningBanner: React.ComponentType<ProjectPaymentWarningBannerProps>;
  BilledBar: React.ComponentType<ProjectBilledBarProps>;
}

const ProjectBillingIntegrationContext =
  createContext<ProjectBillingIntegrationContextType | null>(null);

export const ProjectBillingIntegrationProvider = ProjectBillingIntegrationContext.Provider;

export function useProjectBillingIntegration(): ProjectBillingIntegrationContextType | null {
  return useContext(ProjectBillingIntegrationContext);
}
