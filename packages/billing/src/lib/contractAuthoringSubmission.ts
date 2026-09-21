/**
 * Projects contract-wizard fixed-service draft rows onto the persisted
 * submission shape. Draft-only authoring metadata (resolved catalog rate and
 * its provenance) must never reach the server.
 */
export function projectFixedServicesForSubmission<
  S extends {
    service_id: string;
    service_name?: string;
    quantity: number;
    bucket_overlay?: any;
  },
>(services: readonly S[]): Array<{
  service_id: string;
  service_name?: string;
  quantity: number;
  bucket_overlay?: any;
}> {
  return services.map(({ service_id, service_name, quantity, bucket_overlay }) => ({
    service_id,
    service_name,
    quantity,
    bucket_overlay,
  }));
}
