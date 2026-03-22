export const RECURRING_SERVICE_PERIOD_SUPPORTED_EDIT_OPERATIONS = [
  'boundary_adjustment',
  'skip',
  'defer',
] as const;

export const RECURRING_SERVICE_PERIOD_UNSUPPORTED_V1_EDIT_OPERATIONS = [
  'split',
  'merge',
] as const;

export type SupportedRecurringServicePeriodEditOperation =
  (typeof RECURRING_SERVICE_PERIOD_SUPPORTED_EDIT_OPERATIONS)[number];

export type UnsupportedRecurringServicePeriodV1EditOperation =
  (typeof RECURRING_SERVICE_PERIOD_UNSUPPORTED_V1_EDIT_OPERATIONS)[number];

export function isRecurringServicePeriodV1EditOperationSupported(
  operation: string,
): operation is SupportedRecurringServicePeriodEditOperation {
  return (
    RECURRING_SERVICE_PERIOD_SUPPORTED_EDIT_OPERATIONS as readonly string[]
  ).includes(operation);
}

export function assertRecurringServicePeriodV1EditOperationSupported(operation: string) {
  if (isRecurringServicePeriodV1EditOperationSupported(operation)) {
    return;
  }

  if (
    (RECURRING_SERVICE_PERIOD_UNSUPPORTED_V1_EDIT_OPERATIONS as readonly string[])
      .includes(operation)
  ) {
    throw new Error(`Recurring service-period ${operation} operations are not supported in v1.`);
  }

  throw new Error(`Unknown recurring service-period edit operation "${operation}".`);
}
