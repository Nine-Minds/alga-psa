import { BUILTIN_ASSET_SPEC_FIELDS, normalizeAssetSpecValues } from '@alga-psa/core/builtinAssetSpecs';
import { createAssetSchema } from '@alga-psa/assets/lib/schemas/asset.schema';

const STRUCTURED_DEFAULTS: Record<string, Record<string, unknown>> = {
  workstation: { installed_software: [] },
  network_device: { vlan_config: {}, port_config: {} },
  server: { storage_config: [], network_interfaces: [], installed_services: [] },
  mobile_device: { installed_apps: [] },
  printer: { supported_paper_types: [], supply_levels: {} },
};

export function hasDefaultAssetExtension(assetType: string): boolean {
  return Object.hasOwn(BUILTIN_ASSET_SPEC_FIELDS, assetType);
}

/** Use the asset form's fields, canonical dropdown values, and create schema. */
export function buildDefaultAssetExtension(
  assetType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!hasDefaultAssetExtension(assetType)) return null;
  const defaults = Object.fromEntries(BUILTIN_ASSET_SPEC_FIELDS[assetType].map((field) => [
    field.key, field.defaultValue ?? (field.type === 'number' ? null : field.type === 'boolean' ? false : ''),
  ]));
  const extension = {
    ...STRUCTURED_DEFAULTS[assetType],
    ...defaults,
    ...normalizeAssetSpecValues(assetType, metadata),
  };
  switch (assetType) {
    case 'workstation': return createAssetSchema.shape.workstation.unwrap().parse(extension);
    case 'network_device': return createAssetSchema.shape.network_device.unwrap().parse(extension);
    case 'server': return createAssetSchema.shape.server.unwrap().parse(extension);
    case 'mobile_device': return createAssetSchema.shape.mobile_device.unwrap().parse(extension);
    case 'printer': return createAssetSchema.shape.printer.unwrap().parse(extension);
    default: throw new Error(`Missing delivered asset extension schema for ${assetType}`);
  }
}
