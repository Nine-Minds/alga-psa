export const CONTRACT_LINE_TYPE_DISPLAY: Record<string, string> = {
  Fixed: 'Fixed',
  Hourly: 'Time Based',
  Usage: 'Usage Based'
};

export const CONTRACT_LINE_TYPE_OPTIONS = Object.entries(CONTRACT_LINE_TYPE_DISPLAY).map(([value, label]) => ({
  value,
  label
}));

// Backwards compatibility aliases
export const PLAN_TYPE_DISPLAY = CONTRACT_LINE_TYPE_DISPLAY;
export const PLAN_TYPE_OPTIONS = CONTRACT_LINE_TYPE_OPTIONS;

export const BILLING_FREQUENCY_DISPLAY: Record<string, string> = {
  'monthly': 'Monthly',
  'quarterly': 'Quarterly',
  'annually': 'Annually'
};

export const BILLING_FREQUENCY_OPTIONS = Object.entries(BILLING_FREQUENCY_DISPLAY).map(([value, label]) => ({
  value,
  label
}));
