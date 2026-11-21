// Enterprise service-principal module. The three boundary hooks below are what
// '@product/service-principals/entry' binds to in EE builds.
export {
  resolveServicePrincipalApiContext,
  servicePrincipalKeyGate,
} from './boundary';
export { mapServicePrincipalError } from './errors';
export * from './entitlements';
export * from './service';
export { getServicePrincipalUsage } from './usage';
export type { ServicePrincipalUsage } from './usage';
