// EE implementation surface for the service-principal boundary.
// Resolves to ee/server/src/lib/service-principals/* via the @ee alias in EE builds.
export {
  resolveServicePrincipalApiContext,
  servicePrincipalKeyGate,
  mapServicePrincipalError,
} from '@ee/lib/service-principals';
export type * from '../types';
