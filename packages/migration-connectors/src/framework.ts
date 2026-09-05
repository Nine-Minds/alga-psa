import type { AmpEntityType, AmpManifest } from '@alga-psa/migration-spec';
import { connectwisePsaCsvConnector } from './connectwise/index';

/**
 * What a connector is, in one honest record: what it covers, what it knowingly
 * leaves behind, and what the operator must have in hand before running it.
 */
export interface AmpConnectorDescriptor {
  name: string;
  version: string;
  /** AMP format versions the produced packages conform to, e.g. "1.0.x". */
  supportedAmpVersions: string;
  /** Manifest `source_system` value for produced packages. */
  sourceSystem: string;
  /** Source-system versions/export formats the connector understands. */
  sourceSystemVersions: string;
  /** Per covered entity, where its records come from in the source. */
  entityCoverage: Partial<Record<AmpEntityType, string>>;
  /** Source data the connector knowingly does not carry. */
  knownOmissions: string[];
  /** What the operator needs before `produce` can run. */
  prerequisites: string[];
}

/**
 * A connector reads a source export from `inputDir` and writes one AMP
 * package. Connectors are pure producers: they never touch an Alga tenant.
 */
export interface AmpConnector {
  descriptor: AmpConnectorDescriptor;
  produce(input: {
    inputDir: string;
    outputPath: string;
    namespace: string;
  }): Promise<{ manifest: AmpManifest; rowCounts: Record<string, number> }>;
}

/** Every connector shipped by this package. */
export function listConnectors(): AmpConnector[] {
  return [connectwisePsaCsvConnector];
}
