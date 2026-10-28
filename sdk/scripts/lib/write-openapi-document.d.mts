export function writeDocument(
  outputDir: string,
  baseName: string,
  formats: ReadonlyArray<'json' | 'yaml'>,
  document: unknown,
): string[];
