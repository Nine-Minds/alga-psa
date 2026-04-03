import { describe, expectTypeOf, it } from 'vitest';

import type {
  CadenceOwner,
  IClientContractLine,
  IContractLine,
  IContractLineMapping,
} from '@alga-psa/types';

describe('contract line cadence owner typing', () => {
  it('T103: shared interfaces serialize cadence_owner consistently across contract-line surfaces', () => {
    expectTypeOf<IContractLine['cadence_owner']>().toEqualTypeOf<CadenceOwner | undefined>();
    expectTypeOf<IClientContractLine['cadence_owner']>().toEqualTypeOf<CadenceOwner | undefined>();
    expectTypeOf<IContractLineMapping['cadence_owner']>().toEqualTypeOf<CadenceOwner | undefined>();
  });
});
