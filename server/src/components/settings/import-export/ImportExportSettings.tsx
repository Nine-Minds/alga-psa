'use client';

import MigrationsWorkspace from '../migrations/MigrationsWorkspace';

/**
 * Imports & Exports is backed by AMP. The old asset-only preview/approval
 * entry point is deliberately not exposed: CSV/XLSX asset imports must become
 * AMP packages and use the common staged/preflight/apply lifecycle. Historical
 * legacy rows remain available in their existing tables for audit purposes.
 */
const ImportExportSettings = (): React.JSX.Element => <MigrationsWorkspace />;

export default ImportExportSettings;
