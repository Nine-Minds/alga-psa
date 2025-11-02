// world root:component/root
export type ExecuteRequest = import('./interfaces/alga-extension-types.js').ExecuteRequest;
export type ExecuteResponse = import('./interfaces/alga-extension-types.js').ExecuteResponse;
export type * as AlgaExtensionContext from './interfaces/alga-extension-context.js'; // import alga:extension/context
export type * as AlgaExtensionHttp from './interfaces/alga-extension-http.js'; // import alga:extension/http
export type * as AlgaExtensionLogging from './interfaces/alga-extension-logging.js'; // import alga:extension/logging
export type * as AlgaExtensionSecrets from './interfaces/alga-extension-secrets.js'; // import alga:extension/secrets
export type * as AlgaExtensionStorage from './interfaces/alga-extension-storage.js'; // import alga:extension/storage
export type * as AlgaExtensionTypes from './interfaces/alga-extension-types.js'; // import alga:extension/types
export type * as AlgaExtensionUiProxy from './interfaces/alga-extension-ui-proxy.js'; // import alga:extension/ui-proxy
export function handler(request: ExecuteRequest): ExecuteResponse;
