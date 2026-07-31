"use client";

import React from "react";
import { useProduct } from "@/context/ProductContext";
import { DrawerOutlet } from "@alga-psa/ui";
import { ActivityDrawerProvider } from "@alga-psa/msp-composition/user-activities/ActivityDrawerProvider";
import { SchedulingProviderWithCallbacks } from '@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks';
// Keep granular msp-composition imports: package index barrels pull broad feature trees
// into every wrapped route's RSC manifest.
import { MspTicketIntegrationProvider } from '@alga-psa/msp-composition/projects/MspTicketIntegrationProvider';
import { MspProjectBillingIntegrationProvider } from '@alga-psa/msp-composition/projects/MspProjectBillingIntegrationProvider';
import { MspClientIntegrationProvider } from '@alga-psa/msp-composition/projects/MspClientIntegrationProvider';
import { MspClientDrawerProvider } from '@alga-psa/msp-composition/clients/MspClientDrawerProvider';
import { MspClientCrossFeatureProvider } from '@alga-psa/msp-composition/clients/MspClientCrossFeatureProvider';
import { QuickAddClientProviderWithCallbacks } from '@alga-psa/clients/providers/QuickAddClientProviderWithCallbacks';
// MspClientTagsProvider is now mounted at the shell (DefaultLayout / AlgaDeskMspShell),
// which is always an ancestor of this component — so it no longer needs to be re-mounted here.
import { MspAssetCrossFeatureProvider } from '@alga-psa/msp-composition/assets/MspAssetCrossFeatureProvider';
import { MspDocumentsCrossFeatureProvider } from '@alga-psa/msp-composition/documents/MspDocumentsCrossFeatureProvider';
import { MspSchedulingCrossFeatureProvider } from '@alga-psa/msp-composition/scheduling/MspSchedulingCrossFeatureProvider';
import { MspActivityCrossFeatureProvider } from '@alga-psa/msp-composition/workflows/MspActivityCrossFeatureProvider';

interface WorkspaceProvidersProps {
  children: React.ReactNode;
}

export default function WorkspaceProviders({ children }: WorkspaceProvidersProps) {
  const { isAlgaDesk } = useProduct();

  // AlgaDesk mounts its own (deliberately lean, feature-gated) cross-feature providers
  // and a single DrawerOutlet in AlgaDeskMspShell. Wrapping again here would (1) mount a
  // SECOND DrawerOutlet — both read the one global drawer state, so every drawer renders
  // twice (stacking) — and (2) shadow AlgaDesk's gating with the full MSP stack. So on
  // AlgaDesk this is a passthrough; the full MSP workspace applies only under DefaultLayout.
  if (isAlgaDesk) {
    return <>{children}</>;
  }

  return (
    <SchedulingProviderWithCallbacks>
      <MspTicketIntegrationProvider>
       <MspProjectBillingIntegrationProvider>
        <MspClientIntegrationProvider>
          <ActivityDrawerProvider>
            <MspClientDrawerProvider>
              <MspClientCrossFeatureProvider>
                <MspAssetCrossFeatureProvider>
                  <MspDocumentsCrossFeatureProvider>
                    <MspSchedulingCrossFeatureProvider>
                      <MspActivityCrossFeatureProvider>
                        <QuickAddClientProviderWithCallbacks>
                          {children}
                          <DrawerOutlet />
                        </QuickAddClientProviderWithCallbacks>
                      </MspActivityCrossFeatureProvider>
                    </MspSchedulingCrossFeatureProvider>
                  </MspDocumentsCrossFeatureProvider>
                </MspAssetCrossFeatureProvider>
              </MspClientCrossFeatureProvider>
            </MspClientDrawerProvider>
          </ActivityDrawerProvider>
        </MspClientIntegrationProvider>
       </MspProjectBillingIntegrationProvider>
      </MspTicketIntegrationProvider>
    </SchedulingProviderWithCallbacks>
  );
}
