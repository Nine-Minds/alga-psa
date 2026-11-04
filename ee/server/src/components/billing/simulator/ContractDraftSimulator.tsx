"use client";

import React, { useEffect, useRef, useState } from "react";
import type {
  ContractDraftSimulationInput,
  ContractScenario,
} from "@alga-psa/types";
import {
  isContractSimulationRefusal,
  isContractSimulationUnavailable,
  type SimulationDiagnostic,
} from "@alga-psa/types";
import { getContractDraftSimulationScenario } from "@alga-psa/billing/actions/contractSimulationActions";
import LoadingIndicator from "@alga-psa/ui/components/LoadingIndicator";
import { Alert, AlertDescription } from "@alga-psa/ui/components/Alert";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import ContractSimulatorWorkspace from "./ContractSimulatorWorkspace";
import { SimulationBlockedCallout } from "./SimulationBlockedCallout";

export default function ContractDraftSimulator({
  draft,
}: {
  draft: ContractDraftSimulationInput;
}) {
  const { t } = useTranslation("msp/contracts");
  const [scenario, setScenario] = useState<ContractScenario | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<SimulationDiagnostic | null>(null);
  // The wizard rebuilds the draft object on every render, so refetch on what it
  // says and not on its identity. A reload keeps the live workspace mounted
  // instead of tearing its projection down, and reports itself so the run bar
  // cannot call that projection current while the draft has moved on.
  const draftKey = JSON.stringify(draft);
  const latest = useRef({ draft, t, hasScenario: false });
  latest.current = { draft, t, hasScenario: scenario !== null };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRefusal(null);
    if (latest.current.hasScenario) setIsReloading(true);
    void getContractDraftSimulationScenario(latest.current.draft)
      .then((outcome) => {
        if (cancelled) return;
        if (isContractSimulationUnavailable(outcome)) {
          setError(
            latest.current.t("contractSimulator.unavailable.description", {
              defaultValue:
                "The contract simulator is available in AlgaPSA Pro.",
            }),
          );
          return;
        }
        if (isContractSimulationRefusal(outcome)) {
          setRefusal(outcome.diagnostic);
          return;
        }
        setScenario(outcome);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setIsReloading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  if (refusal) {
    return <SimulationBlockedCallout diagnostics={[refusal]} />;
  }
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
      scenarioReloading={isReloading}
      readOnlyScenario
      clientId={draft.client_id}
    />
  );
}
