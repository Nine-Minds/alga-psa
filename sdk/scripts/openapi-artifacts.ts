import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type OpenApiFormat = 'json' | 'yaml';

export function writeDocument(outputDir: string, baseName: string, formats: OpenApiFormat[], document: unknown) {
  fs.mkdirSync(outputDir, { recursive: true });
  const writtenFiles: string[] = [];

  if (formats.includes('json')) {
    const jsonPath = path.join(outputDir, `${baseName}.json`);
    fs.writeFileSync(jsonPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
    writtenFiles.push(jsonPath);
  }

  if (formats.includes('yaml')) {
    const yamlPath = path.join(outputDir, `${baseName}.yaml`);
    // OpenAPI is a JSON document: shared object identity must not affect its YAML representation.
    fs.writeFileSync(yamlPath, `${YAML.stringify(document, { aliasDuplicateObjects: false })}\n`, 'utf-8');
    writtenFiles.push(yamlPath);
  }

  return writtenFiles;
}
