#!/usr/bin/env tsx

interface SearchBackfillOptions {
  tenant?: string;
  type?: string;
}

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length) || undefined;
  }

  const index = argv.indexOf(`--${name}`);
  if (index >= 0) {
    return argv[index + 1];
  }

  return undefined;
}

export function parseSearchBackfillArgs(argv: string[]): SearchBackfillOptions {
  return {
    tenant: readFlag(argv, 'tenant'),
    type: readFlag(argv, 'type'),
  };
}

export async function runSearchBackfill(options: SearchBackfillOptions): Promise<void> {
  console.log('Search backfill is not configured yet', options);
}

async function main(): Promise<void> {
  const options = parseSearchBackfillArgs(process.argv.slice(2));
  await runSearchBackfill(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Search backfill failed', error);
    process.exitCode = 1;
  });
}
