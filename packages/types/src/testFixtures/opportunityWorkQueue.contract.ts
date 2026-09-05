import type { IWorkQueue } from '../interfaces/opportunity.interfaces';
import { opportunityWorkQueueFixture } from './opportunityWorkQueue';

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

// Compile-time contract check, kept out of opportunityWorkQueue.ts so the
// fixture stays import-free and safe to typecheck from isolated projects
// (ee/mobile). Shape drift from IWorkQueue fails the packages/types typecheck.
export const opportunityWorkQueueContractCheck: DeepReadonly<IWorkQueue> =
  opportunityWorkQueueFixture;
