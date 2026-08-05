"use client";

import React, { useEffect, useState } from "react";
import type {
  ContractDraftSimulationInput,
  ContractScenario,
} from "@alga-psa/types";
import { isContractSimulationUnavailable } from "@alga-psa/types";
import { getContractDraftSimulationScenario } from "@alga-psa/billing/actions/contractSimulationActions";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import ContractSimulatorWorkspace from "./ContractSimulatorWorkspace";

export default function ContractDraftSimulator({
  draft,
}: {
  draft: ContractDraftSimulationInput;
}) {
  const { t } = useTranslation("msp/contracts");
  const [scenario, setScenario] = useState<ContractScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScenario(null);
    setError(null);
    void getContractDraftSimulationScenario(draft)
      .then((outcome) => {
        if (cancelled) return;
        if (isContractSimulationUnavailable(outcome)) {
          setError(
            t("contractSimulator.unavailable.description", {
              defaultValue:
                "The contract simulator is available in AlgaPSA Pro.",
            }),
          );
          return;
        }
        setScenario(outcome);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft, t]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!scenario) {
    return (
      <LoadingIndicator
        layout="stacked"
        text={t("contractSimulator.preparingDraft", {
          defaultValue: "Preparing simulation…",
        })}
      />
    );
  }
  return (
    <ContractSimulatorWorkspace
      initialScenario={scenario}
      readOnlyScenario
      clientId={draft.client_id}
    />
  );
}
