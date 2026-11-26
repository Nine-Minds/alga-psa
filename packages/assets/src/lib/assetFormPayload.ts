import type { Asset, UpdateAssetRequest } from '@alga-psa/types';

export const assetExtensionKeys = ['workstation', 'network_device', 'server', 'mobile_device', 'printer'] as const;
export type AssetExtensionKey = typeof assetExtensionKeys[number];

/**
 * Keep form defaults for fields omitted by the authorized read out of the
 * outgoing patch. The server independently enforces the authorization mask.
 *
 * An asset can have no hardware row at all (e.g. equipment received on a
 * ticket). For those, only an extension the user actually edited is sent, and
 * only the values they filled in, so untouched form defaults never reach the
 * server.
 */
export function retainReadableAssetUpdateFields(
  payload: UpdateAssetRequest,
  asset: Asset,
  editedExtensions: ReadonlySet<AssetExtensionKey> = new Set()
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

  for (const extensionKey of assetExtensionKeys) {
    const submitted = safe[extensionKey] as Record<string, unknown> | undefined;
    const readable = asset[extensionKey] as Record<string, unknown> | null | undefined;
    if (!submitted) {
      delete safe[extensionKey];
      continue;
    }
    if (readable) {
      safe[extensionKey] = Object.fromEntries(
        Object.entries(submitted).filter(([key]) => Object.prototype.hasOwnProperty.call(readable, key))
      );
      continue;
    }
    const entered = editedExtensions.has(extensionKey)
      ? Object.fromEntries(Object.entries(submitted).filter(([, value]) => isEnteredExtensionValue(value)))
      : {};
    if (Object.keys(entered).length > 0) safe[extensionKey] = entered;
    else delete safe[extensionKey];
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

function isEnteredExtensionValue(value: unknown): boolean {
  if (isEmptyFormValue(value)) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function isEmptyFormValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
