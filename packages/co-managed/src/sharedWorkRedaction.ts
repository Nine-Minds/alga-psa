import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** A redacted source also hides its derived value; nested and parent paths
 * hide the whole candidate rather than return partially identifying objects. */
export function isCoManagedReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  return redactions.some(field => {
    if (typeof field !== 'string') throw new CoManagedSharedWorkError();
    if (field === '*' || field === 'fields') return true;
    const path = field.startsWith('fields.') ? field.slice(7) : field;
    return names.some(name => path === name || path.startsWith(`${name}.`) || name.startsWith(`${path}.`));
  });
}
