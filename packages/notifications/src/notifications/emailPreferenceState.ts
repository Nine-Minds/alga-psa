/** Email delivery defaults to enabled; administrator gates always win. */
export function resolveEmailPreferenceEnabled(
  tenantEnabled: boolean | undefined,
  categoryEnabled: boolean | undefined,
  subtypeEnabled: boolean | undefined,
  personalEnabled: boolean | undefined,
): boolean {
  return (tenantEnabled ?? true) && (categoryEnabled ?? true)
    && (subtypeEnabled ?? true) && (personalEnabled ?? true);
}
