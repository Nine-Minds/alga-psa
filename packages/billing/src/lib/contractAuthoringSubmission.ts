/**
 * Projects contract-wizard fixed-service draft rows onto the persisted
 * submission shape. Draft-only authoring metadata (resolved catalog rate and
 * its provenance) must never reach the server. The pricing basis and unit rate
 * are persisted authoring input: dropping them would turn a per-seat member
 * into a bundle allocation on resume + finalize.
 */
export function projectFixedServicesForSubmission<
  S extends {
    service_id: string;
    service_name?: string;
    quantity: number;
    pricing_basis?: 'bundle' | 'unit' | string | null;
    unit_rate?: number | null;
    bucket_overlay?: any;
  },
>(services: readonly S[]): Array<{
  service_id: string;
  service_name?: string;
  quantity: number;
  pricing_basis: 'bundle' | 'unit';
  unit_rate?: number | null;
  bucket_overlay?: any;
}> {
  return services.map(({ service_id, service_name, quantity, pricing_basis, unit_rate, bucket_overlay }) => {
    const isUnit = pricing_basis === 'unit';
    return {
      service_id,
      service_name,
      quantity,
      pricing_basis: isUnit ? ('unit' as const) : ('bundle' as const),
      unit_rate: isUnit ? (unit_rate ?? null) : undefined,
      bucket_overlay,
    };
  });
}
