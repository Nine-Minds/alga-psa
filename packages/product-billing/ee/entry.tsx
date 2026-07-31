'use client';

// EE implementation for Billing features
// Re-exports OSS stubs for features not yet implemented,
// and actual EE implementations for features that exist

import React from 'react';
import PaymentSettingsComponent from '@ee/components/settings/billing/PaymentSettings';
import StripeConnectionSettingsComponent from '@ee/components/settings/integrations/StripeConnectionSettings';
import PaymentSettingsConfigComponent from '@ee/components/settings/billing/PaymentSettingsConfig';
import ContractSimulatorWorkspace from '@ee/components/billing/simulator/ContractSimulatorWorkspace';
import ContractDraftSimulatorComponent from '@ee/components/billing/simulator/ContractDraftSimulator';
import type { ContractDraftSimulationInput } from '@alga-psa/types';

interface ContractSimulatorProps {
  contractId: string;
  clientContractId: string | null;
  clientId: string | null;
  forceProfile?: boolean;
}

// Import OSS stubs for features not yet implemented in EE
export {
  BillingDashboard,
  InvoiceTemplates,
  PaymentProcessing,
  BillingReports
} from '../oss/entry';

// Wrapper components for EE implementations (same pattern as @product/chat)
export const PaymentSettings = () => <PaymentSettingsComponent />;
export const StripeConnectionSettings = () => <StripeConnectionSettingsComponent />;
export const PaymentSettingsConfig = () => <PaymentSettingsConfigComponent />;
// Tier gating (CONTRACT_SIMULATOR) lives inside ContractSimulatorWorkspace —
// importing server/src tier-gating here would create the
// integrations -> @product/billing -> server dependency cycle.
export const ContractSimulator = (props: ContractSimulatorProps) => (
  <ContractSimulatorWorkspace {...props} />
);
export const ContractDraftSimulator = ({ draft }: { draft: ContractDraftSimulationInput }) => (
  <ContractDraftSimulatorComponent draft={draft} />
);

// Default export
export default {
  BillingDashboard: async () => (await import('../oss/entry')).BillingDashboard,
  InvoiceTemplates: async () => (await import('../oss/entry')).InvoiceTemplates,
  PaymentProcessing: async () => (await import('../oss/entry')).PaymentProcessing,
  BillingReports: async () => (await import('../oss/entry')).BillingReports,
  PaymentSettings,
  StripeConnectionSettings,
  PaymentSettingsConfig,
  ContractSimulator,
  ContractDraftSimulator,
};
