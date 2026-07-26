import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseScenario } from './scenario';
import type { Scenario } from './scenario';

export function loadScenarioFile(path: string): Scenario {
  return parseScenario(parseYaml(readFileSync(resolve(path), 'utf8')));
}

export function loadScenarioDir(dir: string): Scenario[] {
  return readdirSync(resolve(dir))
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort()
    .map((file) => loadScenarioFile(join(resolve(dir), file)));
}
