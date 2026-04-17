// @ts-nocheck
// Each route is exposed as an async thunk so webpack treats the EE route files
// as their own async chunks. This breaks the static import cycle that occurred
// when this file pulled from `@enterprise/...` synchronously while
// `packages/integrations/*` was itself a dependency of the EE package.
type RouteModule = {
    GET?: (request: Request) => Promise<Response>;
    POST?: (request: Request) => Promise<Response>;
    OPTIONS?: (request: Request) => Promise<Response>;
};

type RouteLoader = () => Promise<RouteModule>;

export const routes: Record<string, RouteLoader> = {
    route: () => import('@enterprise/app/api/integrations/entra/route'),
    connectRoute: () => import('@enterprise/app/api/integrations/entra/connect/route'),
    disconnectRoute: () => import('@enterprise/app/api/integrations/entra/disconnect/route'),
    validateDirectRoute: () => import('@enterprise/app/api/integrations/entra/validate-direct/route'),
    validateCippRoute: () => import('@enterprise/app/api/integrations/entra/validate-cipp/route'),
    discoveryRoute: () => import('@enterprise/app/api/integrations/entra/discovery/route'),
    syncRoute: () => import('@enterprise/app/api/integrations/entra/sync/route'),
    syncRunsRoute: () => import('@enterprise/app/api/integrations/entra/sync/runs/route'),
    mappingsPreviewRoute: () => import('@enterprise/app/api/integrations/entra/mappings/preview/route'),
    mappingsConfirmRoute: () => import('@enterprise/app/api/integrations/entra/mappings/confirm/route'),
    mappingsUnmapRoute: () => import('@enterprise/app/api/integrations/entra/mappings/unmap/route'),
    mappingsRemapRoute: () => import('@enterprise/app/api/integrations/entra/mappings/remap/route'),
    reconciliationQueueRoute: () => import('@enterprise/app/api/integrations/entra/reconciliation-queue/route'),
    resolveExistingRoute: () => import('@enterprise/app/api/integrations/entra/reconciliation-queue/resolve-existing/route'),
    resolveNewRoute: () => import('@enterprise/app/api/integrations/entra/reconciliation-queue/resolve-new/route'),
};
