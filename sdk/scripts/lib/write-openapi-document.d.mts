export type OpenApiFormat = 'json' | 'yaml';

export function writeDocument(
  outputDir: string,
  baseName: string,
  formats: ReadonlyArray<OpenApiFormat>,
  document: unknown,
): string[];
