// One-line postal address from a client_locations alias; empty parts are skipped
// and an all-empty address yields NULL. Used wherever an API response derives a
// display/map address from a location row.
export function locationAddressSql(alias: string): string {
  const parts = ['address_line1', 'address_line2', 'city', 'state_province', 'postal_code', 'country_name']
    .map((column) => `NULLIF(${alias}.${column}, '')`)
    .join(', ');
  return `NULLIF(CONCAT_WS(', ', ${parts}), '')`;
}
