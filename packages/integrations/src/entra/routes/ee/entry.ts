// @ts-nocheck
import * as route from '@enterprise/app/api/integrations/entra/route';
import * as connectRoute from '@enterprise/app/api/integrations/entra/connect/route';
import * as disconnectRoute from '@enterprise/app/api/integrations/entra/disconnect/route';
import * as validateDirectRoute from '@enterprise/app/api/integrations/entra/validate-direct/route';
import * as validateCippRoute from '@enterprise/app/api/integrations/entra/validate-cipp/route';
import * as discoveryRoute from '@enterprise/app/api/integrations/entra/discovery/route';
import * as syncRoute from '@enterprise/app/api/integrations/entra/sync/route';
import * as syncRunsRoute from '@enterprise/app/api/integrations/entra/sync/runs/route';
import * as mappingsPreviewRoute from '@enterprise/app/api/integrations/entra/mappings/preview/route';
import * as mappingsConfirmRoute from '@enterprise/app/api/integrations/entra/mappings/confirm/route';
import * as mappingsUnmapRoute from '@enterprise/app/api/integrations/entra/mappings/unmap/route';
import * as mappingsRemapRoute from '@enterprise/app/api/integrations/entra/mappings/remap/route';
import * as reconciliationQueueRoute from '@enterprise/app/api/integrations/entra/reconciliation-queue/route';
import * as resolveExistingRoute from '@enterprise/app/api/integrations/entra/reconciliation-queue/resolve-existing/route';
import * as resolveNewRoute from '@enterprise/app/api/integrations/entra/reconciliation-queue/resolve-new/route';

export const routes = {
    route,
    connectRoute,
    disconnectRoute,
    validateDirectRoute,
    validateCippRoute,
    discoveryRoute,
    syncRoute,
    syncRunsRoute,
    mappingsPreviewRoute,
    mappingsConfirmRoute,
    mappingsUnmapRoute,
    mappingsRemapRoute,
    reconciliationQueueRoute,
    resolveExistingRoute,
    resolveNewRoute,
};
