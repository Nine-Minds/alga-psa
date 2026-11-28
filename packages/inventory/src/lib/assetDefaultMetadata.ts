import {
  BUILTIN_ASSET_SPEC_FIELDS,
  normalizeAssetSpecValues,
  partitionAssetSpecValues,
  type AssetSpecValue,
} from '@alga-psa/core/builtinAssetSpecs';
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

/**
 * Seed values for a delivered asset from the product's spec defaults.
 * `extension` is the type-extension payload (schema-parsed); `base` carries the
 * values whose spec field targets a base `assets` column (e.g. Model on
 * `assets.model` for types without a model column in their extension table).
 */
export function buildDefaultAssetSeeds(
  assetType: string,
  metadata: Record<string, unknown> | null | undefined,
): { base: Record<string, AssetSpecValue>; extension: Record<string, unknown> | null } {
  if (!hasDefaultAssetExtension(assetType)) return { base: {}, extension: null };
  const defaults = Object.fromEntries(BUILTIN_ASSET_SPEC_FIELDS[assetType].map((field) => [
    field.key, field.defaultValue ?? (field.type === 'number' ? null : field.type === 'boolean' ? false : ''),
  ]));
  const merged = { ...defaults, ...normalizeAssetSpecValues(assetType, metadata) };
  const { base, extension: specExtension } = partitionAssetSpecValues(assetType, merged);
  const extension = { ...STRUCTURED_DEFAULTS[assetType], ...specExtension };
  let parsed: Record<string, unknown>;
  switch (assetType) {
    case 'workstation': parsed = createAssetSchema.shape.workstation.unwrap().parse(extension); break;
    case 'network_device': parsed = createAssetSchema.shape.network_device.unwrap().parse(extension); break;
    case 'server': parsed = createAssetSchema.shape.server.unwrap().parse(extension); break;
    case 'mobile_device': parsed = createAssetSchema.shape.mobile_device.unwrap().parse(extension); break;
    case 'printer': parsed = createAssetSchema.shape.printer.unwrap().parse(extension); break;
    default: throw new Error(`Missing delivered asset extension schema for ${assetType}`);
  }
  return { base, extension: parsed };
}

/** Extension-only view of the product's spec defaults (asset form / preview callers). */
export function buildDefaultAssetExtension(
  assetType: string,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return buildDefaultAssetSeeds(assetType, metadata).extension;
}
