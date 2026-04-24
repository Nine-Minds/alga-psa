import { registerBaseComponents } from './components';
import { registerAdminRoutes } from './routes/admin';
import { registerAssetRoutes } from './routes/assets';
import { registerAuthRoutes } from './routes/auth';
import { registerBillingRoutes } from './routes/billing';
import { registerBoardRoutes } from './routes/boards';
import { registerChatRoutes } from './routes/chat';
import { registerDocumentRoutes } from './routes/documents';
import { registerEmailRoutes } from './routes/email';
import { registerExtensionGatewayRoutes } from './routes/extensionGateway';
import { registerFileRoutes } from './routes/files';
import { registerInstallRoutes } from './routes/installs';
import { registerStatusRoutes } from './routes/statuses';
import { registerProjectRoutes } from './routes/projects';
import { registerServiceCategoryRoutes } from './routes/serviceCategories';
import { registerServiceRoutes } from './routes/services';
import { registerProductRoutes } from './routes/products';
import { registerQuickBooksRoutes } from './routes/quickbooks';
import { registerServiceTypeRoutes } from './routes/serviceTypes';
import { registerSoftwareOneRoutes } from './routes/softwareOne';
import { registerStorageRoutes } from './routes/extensionStorage';
import { registerSystemRoutes } from './routes/system';
import { registerInventoryBackfillRoutes } from './backfill';
import { ApiOpenApiRegistry, RegistryInitOptions, buildDocument, createRegistry } from './registry';
import { DocumentBuildOptions } from './types';

export function buildBaseRegistry(options: RegistryInitOptions = {}): ApiOpenApiRegistry {
  const registry = createRegistry([], options);
  const components = registerBaseComponents(registry);

  registerAuthRoutes(registry, components);
  registerAdminRoutes(registry);
  registerAssetRoutes(registry);
  registerBillingRoutes(registry);
  registerChatRoutes(registry);
  registerDocumentRoutes(registry);
  registerEmailRoutes(registry);
  registerExtensionGatewayRoutes(registry);
  registerFileRoutes(registry);
  registerSystemRoutes(registry);
  registerInstallRoutes(registry);
  registerQuickBooksRoutes(registry);
  registerBoardRoutes(registry, components);
  registerStatusRoutes(registry, components);
  registerServiceCategoryRoutes(registry, components);
  registerServiceRoutes(registry, components);
  registerProductRoutes(registry, components);
  registerServiceTypeRoutes(registry, components);
  registerProjectRoutes(registry, components);
  registerSoftwareOneRoutes(registry);
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
