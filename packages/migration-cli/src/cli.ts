import { AMP_CLI_EXIT_CODES } from '@alga-psa/migration-spec';
import {
  AmpSqliteReader,
  buildSamplePackage,
  validateAmpPackage,
} from '@alga-psa/migration-sdk';

const USAGE = `alga-migrate — Alga Migration Package (AMP) tooling

Usage:
  alga-migrate validate <package.amp>        Validate a package; exit 0 when valid, 2 when not.
  alga-migrate inspect <package.amp>         Print manifest, tables, and row counts as JSON.
  alga-migrate csv <convert-config.json>     Convert CSV/XLSX files into an AMP package.
  alga-migrate package check <package.amp>   Validate and summarize a package.
  alga-migrate package sample <out.amp>      Write the canonical AMP sample package.

Exit codes: 0 ok, 2 invalid package, 3 I/O or conversion failure, 64 usage error.

The CLI never connects to a database and cannot mutate an Alga tenant.`;

function usageError(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(AMP_CLI_EXIT_CODES.usage);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runValidate(file: string): never {
  const result = validateAmpPackage(file);
  printJson(result);
  process.exit(result.valid ? AMP_CLI_EXIT_CODES.ok : AMP_CLI_EXIT_CODES.invalidPackage);
}

function runInspect(file: string): never {
  let reader: AmpSqliteReader;
  try {
    reader = new AmpSqliteReader(file);
  } catch (error) {
    process.stderr.write(`Cannot open package: ${(error as Error).message}\n`);
    process.exit(AMP_CLI_EXIT_CODES.ioError);
  }
  try {
    const tables = reader.tableNames();
    const manifests = reader.manifestRows();
    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      try {
        rowCounts[table] = reader.rowCount(table as Parameters<typeof reader.rowCount>[0]);
      } catch {
        // Non-allowlisted tables are reported by name only; validate flags them.
      }
    }
    printJson({
      manifest: manifests[0] ?? null,
      manifestRowCount: manifests.length,
      tables,
      rowCounts,
    });
    process.exit(AMP_CLI_EXIT_CODES.ok);
  } finally {
    reader.close();
  }
}

async function runCsv(configPath: string): Promise<never> {
  interface CsvConnectorModule {
    convertSpreadsheetsToAmp: (configPath: string) => Promise<unknown>;
  }
  let convertModule: CsvConnectorModule;
  const csvConnectorSpecifier = '@alga-psa/migration-connectors/csv';
  try {
    convertModule = (await import(csvConnectorSpecifier)) as CsvConnectorModule;
  } catch (error) {
    process.stderr.write(
      `CSV conversion requires @alga-psa/migration-connectors: ${(error as Error).message}\n`
    );
    process.exit(AMP_CLI_EXIT_CODES.ioError);
  }
  try {
    const result = await convertModule.convertSpreadsheetsToAmp(configPath);
    printJson(result);
    process.exit(AMP_CLI_EXIT_CODES.ok);
  } catch (error) {
    process.stderr.write(`Conversion failed: ${(error as Error).message}\n`);
    process.exit(AMP_CLI_EXIT_CODES.ioError);
  }
}

function runPackageCheck(file: string): never {
  const result = validateAmpPackage(file);
  printJson({
    valid: result.valid,
    packageId: result.manifest?.package_id ?? null,
    formatVersion: result.manifest?.format_version ?? null,
    producer: result.manifest
      ? `${result.manifest.producer_name}@${result.manifest.producer_version}`
      : null,
    sourceSystem: result.manifest?.source_system ?? null,
    rowCounts: result.rowCounts,
    diagnosticCount: result.diagnostics.length,
    diagnostics: result.diagnostics,
  });
  process.exit(result.valid ? AMP_CLI_EXIT_CODES.ok : AMP_CLI_EXIT_CODES.invalidPackage);
}

function runPackageSample(outFile: string): never {
  try {
    const manifest = buildSamplePackage(outFile);
    printJson({ written: outFile, manifest });
    process.exit(AMP_CLI_EXIT_CODES.ok);
  } catch (error) {
    process.stderr.write(`Could not write sample package: ${(error as Error).message}\n`);
    process.exit(AMP_CLI_EXIT_CODES.ioError);
  }
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'validate': {
      const [file] = rest;
      if (!file) usageError('validate requires a package file.');
      runValidate(file);
      break;
    }
    case 'inspect': {
      const [file] = rest;
      if (!file) usageError('inspect requires a package file.');
      runInspect(file);
      break;
    }
    case 'csv': {
      const [configPath] = rest;
      if (!configPath) usageError('csv requires a conversion config file.');
      await runCsv(configPath);
      break;
    }
    case 'package': {
      const [subcommand, file] = rest;
      if (subcommand === 'check') {
        if (!file) usageError('package check requires a package file.');
        runPackageCheck(file);
      } else if (subcommand === 'sample') {
        if (!file) usageError('package sample requires an output file.');
        runPackageSample(file);
      } else {
        usageError(`Unknown package subcommand "${subcommand ?? ''}".`);
      }
      break;
    }
    case '--help':
    case '-h':
    case 'help': {
      process.stdout.write(`${USAGE}\n`);
      process.exit(AMP_CLI_EXIT_CODES.ok);
      break;
    }
    default:
      usageError(`Unknown command "${command ?? ''}".`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(AMP_CLI_EXIT_CODES.ioError);
});
