import type { Asset, UpdateAssetRequest } from '@alga-psa/types';

/**
 * Keep form defaults for fields omitted by the authorized read out of the
 * outgoing patch. The server independently enforces the authorization mask.
 */
export function retainReadableAssetUpdateFields(
  payload: UpdateAssetRequest,
  asset: Asset
): UpdateAssetRequest {
  const safe = { ...payload } as Record<string, unknown>;
  const readableBaseFields = [
    'asset_type', 'client_id', 'name', 'asset_tag', 'serial_number', 'status', 'ownership',
    'location_id', 'contact_name_id', 'location', 'purchase_date', 'warranty_end_date',
    'manufacturer', 'model', 'vendor_id', 'purchase_cost', 'purchase_cost_currency', 'order_number',
    'billing_profile_id',
  ];
  for (const key of readableBaseFields) {
    if (!Object.prototype.hasOwnProperty.call(asset, key) && isEmptyFormValue(safe[key])) delete safe[key];
  }

  for (const extensionKey of ['workstation', 'network_device', 'server', 'mobile_device', 'printer'] as const) {
    const submitted = safe[extensionKey] as Record<string, unknown> | undefined;
    const readable = asset[extensionKey] as Record<string, unknown> | undefined;
    if (!submitted || !readable) {
      delete safe[extensionKey];
      continue;
    }
    safe[extensionKey] = Object.fromEntries(
      Object.entries(submitted).filter(([key]) => Object.prototype.hasOwnProperty.call(readable, key))
    );
  }

  const submittedAttributes = safe.attributes as Record<string, unknown> | undefined;
  if (submittedAttributes) {
    const readableAttributes = asset.attributes && typeof asset.attributes === 'object' && !Array.isArray(asset.attributes)
      ? asset.attributes as Record<string, unknown>
      : {};
    const safeAttributes = Object.fromEntries(Object.entries(submittedAttributes).filter(([key, value]) =>
      Object.prototype.hasOwnProperty.call(readableAttributes, key)
      || (value !== undefined && value !== null && value !== '')
    ));
    if (Object.keys(safeAttributes).length > 0) safe.attributes = safeAttributes;
    else delete safe.attributes;
  }

  return safe as UpdateAssetRequest;
}

function isEmptyFormValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
