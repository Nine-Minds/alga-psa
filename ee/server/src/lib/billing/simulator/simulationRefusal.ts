/**
 * Refusals the simulator raises when a scenario can't be simulated for a
 * reason the user can fix. Each carries a ContractSimulationErrorCode plus a
 * localization key and params. They are thrown internally and converted at the
 * simulator entry points into a blocking diagnostic (see
 * simulationRefusalToDiagnostic in
 * @alga-psa/types): Next.js hides the message of an error thrown out of a
 * server action in production builds, so a refusal that escaped would reach the
 * user as "Minified React error #441".
 *
 * Param names with a meaning for the diagnostic: lineKey, lineName, lineType,
 * serviceId, serviceName, configurationType.
 */
import { CodedError, type ActionMessageParams } from "@alga-psa/ui/lib/errorHandling";
import {
  isContractSimulationErrorCode,
  type ContractSimulationErrorCode,
} from "@alga-psa/types";

const MESSAGE_KEYS: Record<ContractSimulationErrorCode, string> = {
  CONTRACT_SIMULATION_UNSUPPORTED_LINE_TYPE: "unsupportedLineType",
  CONTRACT_SIMULATION_UNSUPPORTED_SERVICE_CONFIGURATION:
    "unsupportedServiceConfiguration",
  CONTRACT_SIMULATION_SERVICE_NOT_IN_CATALOG: "serviceNotInCatalog",
  CONTRACT_SIMULATION_POOL_MISSING: "poolMissing",
  CONTRACT_SIMULATION_CONTRACT_NOT_FOUND: "contractNotFound",
  CONTRACT_SIMULATION_CLIENT_NOT_AVAILABLE: "clientNotAvailable",
  CONTRACT_SIMULATION_CLIENT_REQUIRED: "clientRequired",
  CONTRACT_SIMULATION_HISTORY_REQUIRES_CLIENT: "historyRequiresClient",
  CONTRACT_SIMULATION_INVALID_REPLAY_RANGE: "invalidReplayRange",
  CONTRACT_SIMULATION_SCENARIO_INVALID: "scenarioInvalid",
  CONTRACT_SIMULATION_SCENARIO_REFERENCE_INVALID: "scenarioReferenceInvalid",
  CONTRACT_SIMULATION_UNEXPECTED: "unexpected",
};

/**
 * Builds the error to throw. `message` is the English text (and the fallback
 * if the key is missing); `params` fill the `{{placeholders}}` in the
 * localized copy and should name things the way the user sees them.
 */
export function simulationRefusal(
  code: ContractSimulationErrorCode,
  message: string,
  params?: ActionMessageParams,
): CodedError {
  return new CodedError(
    message,
    code,
    `msp/contracts:contractSimulator.errors.${MESSAGE_KEYS[code]}`,
    params,
  );
}

/** The coded refusal behind `error`, or null if it is anything else. */
export function asSimulationRefusal(error: unknown): CodedError | null {
  return error instanceof CodedError && isContractSimulationErrorCode(error.code)
    ? error
    : null;
}
