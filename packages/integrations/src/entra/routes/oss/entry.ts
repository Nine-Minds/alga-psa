type RouteLoader = () => Promise<null>;

const unavailable: RouteLoader = async () => null;

export const routes: Record<string, RouteLoader> = {
    route: unavailable,
    connectRoute: unavailable,
    disconnectRoute: unavailable,
    validateDirectRoute: unavailable,
    validateCippRoute: unavailable,
    discoveryRoute: unavailable,
    syncRoute: unavailable,
    syncPreflightRoute: unavailable,
    syncRunsRoute: unavailable,
    mappingsRoute: unavailable,
    mappingsPreviewRoute: unavailable,
    mappingsConfirmRoute: unavailable,
    mappingsUnmapRoute: unavailable,
    mappingsRemapRoute: unavailable,
    reconciliationQueueRoute: unavailable,
    resolveExistingRoute: unavailable,
    resolveNewRoute: unavailable,
};
