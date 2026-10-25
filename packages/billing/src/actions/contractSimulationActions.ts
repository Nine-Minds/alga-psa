"use server";

import logger from "@alga-psa/core/logger";
import type {
  ContractScenario,
  ContractDraftSimulationInput,
  ContractSimulationRefusal,
  ContractSimulationResult,
  ContractSimulationUnavailable,
  SimulationDiagnostic,
  ISO8601String,
  ScenarioAssumptionPrefill,
} from "@alga-psa/types";
import {
  blockedSimulationResult,
  isContractSimulationRefusalError,
  simulationRefusalToDiagnostic,
} from "@alga-psa/types";
import { createTenantKnex } from "@alga-psa/db";
import { withAuth } from "@alga-psa/auth/withAuth";
import { hasPermission } from "@alga-psa/auth/rbac";
import { isAuthorizationThrow } from "@alga-psa/ui/lib/errorHandling";

function isEnterpriseBuild(): boolean {
  return (
    process.env.EDITION === "ee" ||
    process.env.NEXT_PUBLIC_EDITION === "enterprise"
  );
}

const UNAVAILABLE: ContractSimulationUnavailable = {
  available: false,
  reason: "not_enterprise",
};

async function loadEnterpriseSimulator(): Promise<{
  snapshotContractToScenario: any;
  simulateContractScenario: any;
  loadRecentAverageAssumptions: any;
  loadReplayAssumptions: any;
  draftContractToScenario: any;
} | null> {
  if (!isEnterpriseBuild()) return null;
  try {
    const mod = await import("@enterprise/lib/billing/simulator");
    return {
      snapshotContractToScenario: (mod as any).snapshotContractToScenario,
      simulateContractScenario: (mod as any).simulateContractScenario,
      loadRecentAverageAssumptions: (mod as any).loadRecentAverageAssumptions,
      loadReplayAssumptions: (mod as any).loadReplayAssumptions,
      draftContractToScenario: (mod as any).draftContractToScenario,
    };
  } catch (error) {
    logger.debug(
      "[billing/contractSimulationActions] enterprise simulator module not available",
      {
        error,
      },
    );
    return null;
  }
}

const UNEXPECTED_MESSAGE =
  "The simulator couldn't run because of an unexpected error. Try again; if it keeps happening, contact support.";

/** The blocking diagnostic for a failure out of a simulator operation. */
function failureDiagnostic(
  operation: string,
  error: unknown,
): SimulationDiagnostic {
  if (isContractSimulationRefusalError(error)) {
    return simulationRefusalToDiagnostic(error);
  }
  // Not something the simulator refused on purpose: keep the detail in the
  // log and give the user a sentence instead of a minified React error.
  logger.error(
    `[billing/contractSimulationActions] ${operation} failed unexpectedly`,
    { error },
  );
  return simulationRefusalToDiagnostic({
    message: UNEXPECTED_MESSAGE,
    code: "CONTRACT_SIMULATION_UNEXPECTED",
    messageKey: "msp/contracts:contractSimulator.errors.unexpected",
  });
}

/**
 * Safety-net boundary for the operations that don't return a result
 * (snapshot, draft scenario, prefill). Next.js hides the message of an error
 * thrown out of a server action in production builds (the user sees "Minified
 * React error #441"), so a coded refusal comes back as a typed refusal the UI
 * renders, and anything else is logged and comes back as a generic one.
 * Permission and session failures keep their existing thrown path.
 */
async function refusalAware<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T | ContractSimulationRefusal> {
  try {
    return await run();
  } catch (error) {
    if (isAuthorizationThrow(error)) throw error;
    return { refused: true, diagnostic: failureDiagnostic(operation, error) };
  }
}

/**
 * Same backstop for a simulation run. The simulator already returns a refusal
 * as a blocking result (periods: [], an `error` diagnostic); this only catches
 * one that escaped, and returns it the same way.
 */
async function runAware(
  scenario: ContractScenario,
  run: () => Promise<ContractSimulationResult>,
): Promise<ContractSimulationResult> {
  try {
    return await run();
  } catch (error) {
    if (isAuthorizationThrow(error)) throw error;
    return blockedSimulationResult(scenario, [
      failureDiagnostic("simulation run", error),
    ]);
  }
}

/**
 * Load a live contract's full billing configuration into an in-memory
 * scenario the simulator workspace can mutate freely. EE only; CE builds
 * receive a structured feature-unavailable result.
 */
export const getContractScenarioSnapshot = withAuth(
  async (
    user,
    { tenant },
    contractId: string,
    clientContractId?: string | null,
    clientId?: string | null,
    forceProfile = false,
  ): Promise<
    ContractScenario | ContractSimulationUnavailable | ContractSimulationRefusal
  > => {
    if (!(await hasPermission(user, "billing", "read"))) {
      throw new Error("Permission denied: Cannot read billing");
    }

    const ee = await loadEnterpriseSimulator();
    if (!ee?.snapshotContractToScenario) return UNAVAILABLE;

    const { knex } = await createTenantKnex();
    return refusalAware("snapshot", () =>
      ee.snapshotContractToScenario(knex, tenant, {
        contractId,
        clientContractId: clientContractId ?? null,
        clientId: clientId ?? null,
        forceProfile,
      }),
    );
  },
);

export const getContractDraftSimulationScenario = withAuth(
  async (
    user,
    { tenant },
    draft: ContractDraftSimulationInput,
  ): Promise<
    ContractScenario | ContractSimulationUnavailable | ContractSimulationRefusal
  > => {
    if (!(await hasPermission(user, "billing", "read"))) {
      throw new Error("Permission denied: Cannot read billing");
    }
    const ee = await loadEnterpriseSimulator();
    if (!ee?.draftContractToScenario) return UNAVAILABLE;
    const { knex } = await createTenantKnex();
    return refusalAware("draft scenario", () =>
      ee.draftContractToScenario(knex, tenant, draft),
    );
  },
);

/**
 * Price a scenario through the shared pure billing compute layer over its
 * horizon. Strictly read-only against the database — no billing rows are
 * created, updated, or deleted by a simulation run.
 */
export const runContractSimulation = withAuth(
  async (
    user,
    { tenant },
    scenario: ContractScenario,
  ): Promise<
    ContractSimulationResult | ContractSimulationUnavailable
  > => {
    if (!(await hasPermission(user, "billing", "read"))) {
      throw new Error("Permission denied: Cannot read billing");
    }

    const ee = await loadEnterpriseSimulator();
    if (!ee?.simulateContractScenario) return UNAVAILABLE;

    const { knex } = await createTenantKnex();
    return runAware(scenario, () =>
      ee.simulateContractScenario(knex, tenant, scenario),
    );
  },
);

export const getRecentContractSimulationAssumptions = withAuth(
  async (
    user,
    { tenant },
    scenario: ContractScenario,
    periodCount = 3,
  ): Promise<
    | ScenarioAssumptionPrefill
    | ContractSimulationUnavailable
    | ContractSimulationRefusal
  > => {
    if (!(await hasPermission(user, "billing", "read"))) {
      throw new Error("Permission denied: Cannot read billing");
    }
    const ee = await loadEnterpriseSimulator();
    if (!ee?.loadRecentAverageAssumptions) return UNAVAILABLE;
    const { knex } = await createTenantKnex();
    return refusalAware("recent-average assumptions", () =>
      ee.loadRecentAverageAssumptions(knex, tenant, scenario, periodCount),
    );
  },
);

export const getContractSimulationReplayAssumptions = withAuth(
  async (
    user,
    { tenant },
    scenario: ContractScenario,
    startDate: ISO8601String,
    endDateExclusive: ISO8601String,
  ): Promise<
    | ScenarioAssumptionPrefill
    | ContractSimulationUnavailable
    | ContractSimulationRefusal
  > => {
    if (!(await hasPermission(user, "billing", "read"))) {
      throw new Error("Permission denied: Cannot read billing");
    }
    const ee = await loadEnterpriseSimulator();
    if (!ee?.loadReplayAssumptions) return UNAVAILABLE;
    const { knex } = await createTenantKnex();
    return refusalAware("replay assumptions", () =>
      ee.loadReplayAssumptions(knex, tenant, scenario, startDate, endDateExclusive),
    );
  },
);

/**
 * Lightweight client list for the template simulator's client-context picker.
 * Lives in billing so the picker does not need a cross-feature import of
 * @alga-psa/clients.
 */
export const listContractSimulationClients = withAuth(
  async (
    user,
    { tenant },
  ): Promise<Array<{ client_id: string; client_name: string }>> => {
    if (!(await hasPermission(user, "billing", "read"))) {
      throw new Error("Permission denied: Cannot read billing");
    }

    const { knex } = await createTenantKnex();
    return knex("clients")
      .where({ tenant, is_inactive: false })
      .orderBy("client_name", "asc")
      .select("client_id", "client_name");
  },
);
