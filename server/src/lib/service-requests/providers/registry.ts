import { allAuthenticatedClientUsersVisibilityProvider } from './builtins/allAuthenticatedClientUsersVisibilityProvider';
import { basicFormBehaviorProvider } from './builtins/basicFormBehaviorProvider';
import { starterTemplateProvider } from './builtins/starterTemplateProvider';
import { ticketOnlyExecutionProvider } from './builtins/ticketOnlyExecutionProvider';
import type {
  ServiceRequestAdminExtensionProvider,
  ServiceRequestExecutionProvider,
  ServiceRequestFormBehaviorProvider,
  ServiceRequestProviderRegistrations,
  ServiceRequestTemplateProvider,
  ServiceRequestVisibilityProvider,
} from './contracts';

interface ServiceRequestProviderRegistryStore {
  executionProviders: Map<string, ServiceRequestExecutionProvider>;
  formBehaviorProviders: Map<string, ServiceRequestFormBehaviorProvider>;
  visibilityProviders: Map<string, ServiceRequestVisibilityProvider>;
  templateProviders: Map<string, ServiceRequestTemplateProvider>;
  adminExtensionProviders: Map<string, ServiceRequestAdminExtensionProvider>;
}

const builtInRegistrations: ServiceRequestProviderRegistrations = {
  executionProviders: [ticketOnlyExecutionProvider],
  formBehaviorProviders: [basicFormBehaviorProvider],
  visibilityProviders: [allAuthenticatedClientUsersVisibilityProvider],
  templateProviders: [starterTemplateProvider],
  adminExtensionProviders: [],
};

declare global {
  // eslint-disable-next-line no-var
  var __algaServiceRequestProviderRegistry: ServiceRequestProviderRegistryStore | undefined;
}

function createEmptyStore(): ServiceRequestProviderRegistryStore {
  return {
    executionProviders: new Map(),
    formBehaviorProviders: new Map(),
    visibilityProviders: new Map(),
    templateProviders: new Map(),
    adminExtensionProviders: new Map(),
  };
}

function registerStoreProviders(
  store: ServiceRequestProviderRegistryStore,
  registrations: ServiceRequestProviderRegistrations
): void {
  for (const provider of registrations.executionProviders) {
    store.executionProviders.set(provider.key, provider);
  }
  for (const provider of registrations.formBehaviorProviders) {
    store.formBehaviorProviders.set(provider.key, provider);
  }
  for (const provider of registrations.visibilityProviders) {
    store.visibilityProviders.set(provider.key, provider);
  }
  for (const provider of registrations.templateProviders) {
    store.templateProviders.set(provider.key, provider);
  }
  for (const provider of registrations.adminExtensionProviders ?? []) {
    store.adminExtensionProviders.set(provider.key, provider);
  }
}

function createStoreWithBuiltIns(): ServiceRequestProviderRegistryStore {
  const store = createEmptyStore();
  registerStoreProviders(store, builtInRegistrations);
  return store;
}

function getOrCreateStore(): ServiceRequestProviderRegistryStore {
  if (!globalThis.__algaServiceRequestProviderRegistry) {
    globalThis.__algaServiceRequestProviderRegistry = createStoreWithBuiltIns();
  }
  return globalThis.__algaServiceRequestProviderRegistry;
}

export function registerServiceRequestProviders(registrations: ServiceRequestProviderRegistrations): void {
  registerStoreProviders(getOrCreateStore(), registrations);
}

export function getServiceRequestExecutionProvider(key: string): ServiceRequestExecutionProvider | undefined {
  return getOrCreateStore().executionProviders.get(key);
}

export function getServiceRequestFormBehaviorProvider(
  key: string
): ServiceRequestFormBehaviorProvider | undefined {
  return getOrCreateStore().formBehaviorProviders.get(key);
}

export function getServiceRequestVisibilityProvider(key: string): ServiceRequestVisibilityProvider | undefined {
  return getOrCreateStore().visibilityProviders.get(key);
}

export function getServiceRequestTemplateProvider(key: string): ServiceRequestTemplateProvider | undefined {
  return getOrCreateStore().templateProviders.get(key);
}

export function getServiceRequestAdminExtensionProvider(
  key: string
): ServiceRequestAdminExtensionProvider | undefined {
  return getOrCreateStore().adminExtensionProviders.get(key);
}

export function listServiceRequestExecutionProviders(): ServiceRequestExecutionProvider[] {
  return [...getOrCreateStore().executionProviders.values()];
}

export function listServiceRequestFormBehaviorProviders(): ServiceRequestFormBehaviorProvider[] {
  return [...getOrCreateStore().formBehaviorProviders.values()];
}

export function listServiceRequestVisibilityProviders(): ServiceRequestVisibilityProvider[] {
  return [...getOrCreateStore().visibilityProviders.values()];
}

export function listServiceRequestTemplateProviders(): ServiceRequestTemplateProvider[] {
  return [...getOrCreateStore().templateProviders.values()];
}

export function listServiceRequestAdminExtensionProviders(): ServiceRequestAdminExtensionProvider[] {
  return [...getOrCreateStore().adminExtensionProviders.values()];
}

export function resetServiceRequestProviderRegistry(): void {
  globalThis.__algaServiceRequestProviderRegistry = createStoreWithBuiltIns();
}
