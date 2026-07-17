import { describe, expect, it } from 'vitest';

import {
  resolveContractLineServiceConfigurationType,
  type ContractLineServiceConfigurationType,
  type ContractLineType,
} from '../src/lib/contractLineServiceConfigPolicy';

const LINE_TYPES: ContractLineType[] = ['Fixed', 'Hourly', 'Usage'];
const CONFIG_TYPES: ContractLineServiceConfigurationType[] = ['Fixed', 'Hourly', 'Usage', 'Bucket'];

describe('contract line service configuration policy', () => {
  it.each(LINE_TYPES)('defaults to the line mode when no explicit type is requested (%s)', (lineType) => {
    expect(resolveContractLineServiceConfigurationType(lineType)).toBe(lineType);
  });

  it.each(LINE_TYPES)('accepts the matching type and Bucket on %s lines', (lineType) => {
    expect(resolveContractLineServiceConfigurationType(lineType, lineType)).toBe(lineType);
    expect(resolveContractLineServiceConfigurationType(lineType, 'Bucket')).toBe('Bucket');
  });

  it.each(
    LINE_TYPES.flatMap((lineType) =>
      CONFIG_TYPES
        .filter((configType) => configType !== lineType && configType !== 'Bucket')
        .map((configType) => [lineType, configType] as const)
    )
  )('rejects %s lines given an incompatible explicit %s configuration', (lineType, configType) => {
    expect(() => resolveContractLineServiceConfigurationType(lineType, configType)).toThrow(
      `Configuration type ${configType} is not valid for ${lineType} contract lines`
    );
  });

  it('falls back to Fixed-only for unknown line modes', () => {
    expect(resolveContractLineServiceConfigurationType('Bucket', 'Fixed')).toBe('Fixed');
    expect(() => resolveContractLineServiceConfigurationType('Bucket', 'Hourly')).toThrow(
      'Configuration type Hourly is not valid for Bucket contract lines. Allowed: Fixed.'
    );
    expect(() => resolveContractLineServiceConfigurationType('Bucket')).toThrow(
      'Configuration type Bucket is not valid for Bucket contract lines. Allowed: Fixed.'
    );
  });
});
