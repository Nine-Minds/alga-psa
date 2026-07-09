"use client";

import React from "react";
import { DrawerOutlet } from "@alga-psa/ui";
import { ActivityDrawerProvider } from "@alga-psa/msp-composition/user-activities/ActivityDrawerProvider";
import { SchedulingProviderWithCallbacks } from '@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks';
// Keep granular msp-composition imports: package index barrels pull broad feature trees
// into every wrapped route's RSC manifest.
import { MspTicketIntegrationProvider } from '@alga-psa/msp-composition/projects/MspTicketIntegrationProvider';
import { MspClientIntegrationProvider } from '@alga-psa/msp-composition/projects/MspClientIntegrationProvider';
import { MspClientDrawerProvider } from '@alga-psa/msp-composition/clients/MspClientDrawerProvider';
import { MspClientCrossFeatureProvider } from '@alga-psa/msp-composition/clients/MspClientCrossFeatureProvider';
import { QuickAddClientProviderWithCallbacks } from '@alga-psa/clients/providers/QuickAddClientProviderWithCallbacks';
import { MspAssetCrossFeatureProvider } from '@alga-psa/msp-composition/assets/MspAssetCrossFeatureProvider';
import { MspDocumentsCrossFeatureProvider } from '@alga-psa/msp-composition/documents/MspDocumentsCrossFeatureProvider';
import { MspSchedulingCrossFeatureProvider } from '@alga-psa/msp-composition/scheduling/MspSchedulingCrossFeatureProvider';
import { MspActivityCrossFeatureProvider } from '@alga-psa/msp-composition/workflows/MspActivityCrossFeatureProvider';

interface WorkspaceProvidersProps {
  children: React.ReactNode;
}

export default function WorkspaceProviders({ children }: WorkspaceProvidersProps) {
  return (
    <SchedulingProviderWithCallbacks>
      <MspTicketIntegrationProvider>
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
      </MspTicketIntegrationProvider>
    </SchedulingProviderWithCallbacks>
  );
}
