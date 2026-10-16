import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** Owner-scoped paths produced by native uploads and generated PDFs. */
export function coManagedPortableNativeFilePath(tenant: string, input: unknown): string {
  if (typeof input !== 'string' || /[\\\x00-\x1f]/.test(input)) throw new CoManagedSharedWorkError();
  const parts = input.replace(/^\//, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new CoManagedSharedWorkError();
  // Current native uploads and generated PDF uploads use these two layouts.
  if (!((parts[0] === tenant && parts.length >= 2) || (parts[0] === 'pdfs' && parts[1] === tenant && parts.length >= 3))) throw new CoManagedSharedWorkError();
  return input;
}

