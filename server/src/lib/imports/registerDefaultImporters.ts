import { ImportRegistry } from './ImportRegistry';
import { CsvImporter } from './CsvImporter';
import { NableExportImporter } from './NableExportImporter';
import { ConnectWiseRmmExportImporter } from './ConnectWiseRmmExportImporter';
import { DattoRmmExportImporter } from './DattoRmmExportImporter';
import { AbstractImporter } from './AbstractImporter';

const ensureRegistered = (
  registry: ImportRegistry,
  sourceType: string,
  factory: () => AbstractImporter
) => {
  if (!registry.has(sourceType)) {
    registry.register(factory());
  }
};

export const registerDefaultImporters = (registry: ImportRegistry = ImportRegistry.getInstance()): void => {
  ensureRegistered(registry, 'csv_upload', () => new CsvImporter());
  ensureRegistered(registry, 'n-able_export', () => new NableExportImporter());
  ensureRegistered(registry, 'connectwise_rmm_export', () => new ConnectWiseRmmExportImporter());
  ensureRegistered(registry, 'datto_rmm_export', () => new DattoRmmExportImporter());
};
