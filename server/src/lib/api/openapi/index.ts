import { registerBaseComponents } from './components';
import { registerAdminRoutes } from './routes/admin';
import { registerAssetRoutes } from './routes/assets';
import { registerAutomationRoutes } from './routes/automation';
import { registerAuthRoutes } from './routes/auth';
import { registerBillingRoutes } from './routes/billing';
import { registerBoardRoutes } from './routes/boards';
import { registerChatRoutes } from './routes/chat';
import { registerClientContactRoutes } from './routes/clientsContacts';
import { registerContractLineRoutes } from './routes/contractLines';
import { registerDocumentRoutes } from './routes/documents';
import { registerEmailRoutes } from './routes/email';
import { registerExtensionGatewayRoutes } from './routes/extensionGateway';
import { registerFileRoutes } from './routes/files';
import { registerFinancialInvoiceRoutes } from './routes/financialInvoices';
import { registerInstallRoutes } from './routes/installs';
import { registerStatusRoutes } from './routes/statuses';
import { registerProjectRoutes } from './routes/projects';
import { registerServiceCategoryRoutes } from './routes/serviceCategories';
import { registerServiceRoutes } from './routes/services';
import { registerProductRoutes } from './routes/products';
import { registerQuickBooksRoutes } from './routes/quickbooks';
import { registerQuickBooksV1Routes } from './routes/quickbooksV1';
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
  registerAutomationRoutes(registry);
  registerBillingRoutes(registry);
  registerChatRoutes(registry);
  registerClientContactRoutes(registry);
  registerContractLineRoutes(registry);
  registerDocumentRoutes(registry);
  registerEmailRoutes(registry);
  registerExtensionGatewayRoutes(registry);
  registerFinancialInvoiceRoutes(registry);
  registerFileRoutes(registry);
  registerSystemRoutes(registry);
  registerInstallRoutes(registry);
  registerQuickBooksRoutes(registry);
  registerQuickBooksV1Routes(registry);
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
