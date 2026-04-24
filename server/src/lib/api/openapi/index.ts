import { registerBaseComponents } from './components';
import { registerAuthRoutes } from './routes/auth';
import { registerBillingRoutes } from './routes/billing';
import { registerBoardRoutes } from './routes/boards';
import { registerChatRoutes } from './routes/chat';
import { registerDocumentRoutes } from './routes/documents';
import { registerEmailRoutes } from './routes/email';
import { registerStatusRoutes } from './routes/statuses';
import { registerProjectRoutes } from './routes/projects';
import { registerServiceCategoryRoutes } from './routes/serviceCategories';
import { registerServiceRoutes } from './routes/services';
import { registerProductRoutes } from './routes/products';
import { registerServiceTypeRoutes } from './routes/serviceTypes';
import { registerStorageRoutes } from './routes/extensionStorage';
import { registerInventoryBackfillRoutes } from './backfill';
import { ApiOpenApiRegistry, RegistryInitOptions, buildDocument, createRegistry } from './registry';
import { DocumentBuildOptions } from './types';

export function buildBaseRegistry(options: RegistryInitOptions = {}): ApiOpenApiRegistry {
  const registry = createRegistry([], options);
  const components = registerBaseComponents(registry);

  registerAuthRoutes(registry, components);
  registerBillingRoutes(registry);
  registerChatRoutes(registry);
  registerDocumentRoutes(registry);
  registerEmailRoutes(registry);
  registerBoardRoutes(registry, components);
  registerStatusRoutes(registry, components);
  registerServiceCategoryRoutes(registry, components);
  registerServiceRoutes(registry, components);
  registerProductRoutes(registry, components);
  registerServiceTypeRoutes(registry, components);
  registerProjectRoutes(registry, components);
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
