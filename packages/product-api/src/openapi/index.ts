import { registerBaseComponents } from './components';
import { registerServiceCategoryRoutes } from './routes/serviceCategories';
import { registerStorageRoutes } from './routes/extensionStorage';
import { registerInventoryBackfillRoutes } from './backfill';
import { ApiOpenApiRegistry, RegistryInitOptions, buildDocument, createRegistry } from './registry';
import { DocumentBuildOptions } from './types';

export function buildBaseRegistry(options: RegistryInitOptions = {}): ApiOpenApiRegistry {
  const registry = createRegistry([], options);
  const components = registerBaseComponents(registry);

  registerServiceCategoryRoutes(registry, components);
  registerInventoryBackfillRoutes(registry, components);
  registerStorageRoutes(registry, components);

  return registry;
}

export function generateBaseDocument(options: DocumentBuildOptions) {
  const registry = buildBaseRegistry({ edition: options.edition });
  return buildDocument(registry, options);
}

export * from './types';
export * from './registry';
