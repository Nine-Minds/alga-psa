// Export all import-related modules
export { SourceRegistry } from './registry';
export { ImportManager } from './ImportManager';
export { Importer, AbstractImporter, Page, MappedResult, ImportContext } from './importer';
export { QboCustomerImporter } from './qbo/QboCustomerImporter';

// Initialize importers on module load
import { SourceRegistry } from './registry';
import { QboCustomerImporter } from './qbo/QboCustomerImporter';

// Register QBO importer
SourceRegistry.getInstance().registerImporter('qbo', QboCustomerImporter as any);