import fs from 'node:fs';
import path from 'node:path';

type OperationUse = {
  method: string;
  path: string;
  status: string;
};

type ScanResult = {
  file: string;
  componentCount: number;
  operationCount: number;
  components: Array<{
    name: string;
    operationCount: number;
    examples: OperationUse[];
  }>;
  inlineUntypedDataResponses: OperationUse[];
};

function readJson(filePath: string): any {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function scanSpec(filePath: string): ScanResult {
  const spec = readJson(filePath);

  const componentNames = new Set<string>();
  const schemas = spec?.components?.schemas ?? {};
  for (const [name, schema] of Object.entries<any>(schemas)) {
    if ((schema?.properties ?? {}).data && JSON.stringify(schema.properties.data) === '{}') {
      componentNames.add(name);
    }
  }

  const usesByComponent = new Map<string, OperationUse[]>();
  const inlineUntypedDataResponses: OperationUse[] = [];

  for (const [routePath, methods] of Object.entries<any>(spec?.paths ?? {})) {
    for (const [method, operation] of Object.entries<any>(methods ?? {})) {
      if (!operation || typeof operation !== 'object') continue;
      for (const [status, response] of Object.entries<any>(operation.responses ?? {})) {
        const schema = response?.content?.['application/json']?.schema;
        if (!schema || typeof schema !== 'object') continue;

        if (schema.$ref && typeof schema.$ref === 'string') {
          const name = schema.$ref.split('/').at(-1) ?? '';
          if (componentNames.has(name)) {
            const entries = usesByComponent.get(name) ?? [];
            entries.push({ method: method.toUpperCase(), path: routePath, status });
            usesByComponent.set(name, entries);
          }
          continue;
        }

        const dataSchema = schema?.properties?.data;
        if (dataSchema && JSON.stringify(dataSchema) === '{}') {
          inlineUntypedDataResponses.push({ method: method.toUpperCase(), path: routePath, status });
        }
      }
    }
  }

  const components = Array.from(componentNames)
    .sort()
    .map((name) => {
      const uses = usesByComponent.get(name) ?? [];
      return {
        name,
        operationCount: uses.length,
        examples: uses.slice(0, 5),
      };
    });

  return {
    file: filePath,
    componentCount: componentNames.size,
    operationCount: components.reduce((sum, item) => sum + item.operationCount, 0),
    components,
    inlineUntypedDataResponses,
  };
}

function resolveInputPaths(args: string[]): string[] {
  if (args.length > 0) {
    return args.map((arg) => path.resolve(process.cwd(), arg));
  }

  return [
    path.resolve(process.cwd(), 'docs/openapi/alga-openapi.ce.json'),
    path.resolve(process.cwd(), 'docs/openapi/alga-openapi.ee.json'),
  ];
}

function printResult(result: ScanResult) {
  console.log(`\n# ${result.file}`);
  console.log(`components_with_untyped_data=${result.componentCount}`);
  console.log(`operations_using_untyped_components=${result.operationCount}`);

  if (result.components.length === 0 && result.inlineUntypedDataResponses.length === 0) {
    console.log('no_untyped_success_data_found=true');
    return;
  }

  for (const component of result.components) {
    console.log(`- component=${component.name} operations=${component.operationCount}`);
    for (const sample of component.examples) {
      console.log(`  example=${sample.method} ${sample.path} (${sample.status})`);
    }
  }

  if (result.inlineUntypedDataResponses.length > 0) {
    console.log(`inline_untyped_data_responses=${result.inlineUntypedDataResponses.length}`);
    for (const sample of result.inlineUntypedDataResponses.slice(0, 10)) {
      console.log(`  inline_example=${sample.method} ${sample.path} (${sample.status})`);
    }
  }
}

function main() {
  const inputPaths = resolveInputPaths(process.argv.slice(2));
  let hasFindings = false;

  for (const filePath of inputPaths) {
    if (!fs.existsSync(filePath)) {
      console.error(`missing_spec_file=${filePath}`);
      process.exitCode = 1;
      return;
    }

    const result = scanSpec(filePath);
    printResult(result);

    if (result.componentCount > 0 || result.inlineUntypedDataResponses.length > 0) {
      hasFindings = true;
    }
  }

  if (hasFindings) {
    process.exitCode = 2;
  }
}

main();
