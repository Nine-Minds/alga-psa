import { v5 as uuidv5 } from 'uuid';

// Fixed namespace for opaque references to store-local authors (never reused for anything else).
export const LOCAL_AUTHOR_REFERENCE_NAMESPACE = '6f0c5e0e-3a54-4f0b-9f0d-5b7f2f5a1c11';

/**
 * A foreign viewer sees a store-local author (a customer user or contact has no actor-reference row) only through a
 * stable, opaque, non-empty reference: a uuidv5 of store tenant, author kind and author id. The raw id never leaves
 * the server, and the same author maps to the same reference on every load.
 */
export const localAuthorReference = (storeTenant: string, kind: string, id: string) =>
  uuidv5(`${storeTenant}:${kind}:${id}`, LOCAL_AUTHOR_REFERENCE_NAMESPACE);
