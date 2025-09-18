import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildBaseRegistry, buildDocument, DocumentBuildOptions } from '../../server/src/lib/api/openapi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CliOptions {
  edition: 'ce' | 'ee';
  outputDir: string;
  version: string;
  title?: string;
  description?: string;
  formats: Array<'json' | 'yaml'>;
}

function readRootPackageVersion(rootDir: string): string {
  try {
    const pkgPath = path.join(rootDir, 'package.json');
    const content = fs.readFileSync(pkgPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (typeof parsed.version === 'string' && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Unable to read package version, defaulting to 0.1.0', error);
  }
  return '0.1.0';
}

function parseCliOptions(rootDir: string): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    edition: 'ce',
    outputDir: path.resolve(__dirname, '../docs/openapi'),
    version: readRootPackageVersion(rootDir),
    formats: ['json', 'yaml'],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = args[i + 1];

    switch (key) {
      case 'edition':
        if (value === 'ce' || value === 'ee') {
          options.edition = value;
          i += 1;
        }
        break;
      case 'output':
        if (value) {
          options.outputDir = path.resolve(rootDir, value);
          i += 1;
        }
        break;
      case 'version':
        if (value) {
          options.version = value;
          i += 1;
        }
        break;
      case 'title':
        if (value) {
          options.title = value;
          i += 1;
        }
        break;
      case 'description':
        if (value) {
          options.description = value;
          i += 1;
        }
        break;
      case 'formats':
        if (value) {
          const formats = value.split(',').map((fmt) => fmt.trim().toLowerCase());
          options.formats = formats.filter((fmt): fmt is 'json' | 'yaml' => fmt === 'json' || fmt === 'yaml');
          i += 1;
        }
        break;
      default:
        break;
    }
  }

  return options;
}

function writeDocument(outputDir: string, baseName: string, formats: CliOptions['formats'], document: unknown) {
  fs.mkdirSync(outputDir, { recursive: true });
  const writtenFiles: string[] = [];

  if (formats.includes('json')) {
    const jsonPath = path.join(outputDir, `${baseName}.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    writtenFiles.push(jsonPath);
  }

  if (formats.includes('yaml')) {
    const yamlPath = path.join(outputDir, `${baseName}.yaml`);
    fs.writeFileSync(yamlPath, `${YAML.stringify(document)}\n`, 'utf-8');
    writtenFiles.push(yamlPath);
  }

  return writtenFiles;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const options = parseCliOptions(repoRoot);

  const registry = buildBaseRegistry({ edition: options.edition });

  const metadata: DocumentBuildOptions = {
    title: options.title ?? 'Alga PSA API',
    version: options.version,
    description: options.description ?? 'OpenAPI specification generated from registered route metadata.',
    edition: options.edition,
    servers: [
      { url: 'https://algapsa.com', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
  };

  const document = buildDocument(registry, metadata);

  const baseName = `alga-openapi.${options.edition}`;
  const writtenFiles = writeDocument(options.outputDir, baseName, options.formats, document);

  if (options.edition === 'ce') {
    writeDocument(options.outputDir, 'alga-openapi', options.formats, document);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Generated OpenAPI spec for edition "${options.edition}" with ${registry.getRegisteredRoutes().length} routes.`,
  );
  // eslint-disable-next-line no-console
  writtenFiles.forEach((file) => console.log(` - ${file}`));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to generate OpenAPI specification', error);
  process.exitCode = 1;
});
