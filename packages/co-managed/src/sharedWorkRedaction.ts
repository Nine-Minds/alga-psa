import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** A redacted source also hides its derived value; nested and parent paths
 * hide the whole candidate rather than return partially identifying objects. */
export function isCoManagedReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  return redactions.some(field => {
    if (typeof field !== 'string') throw new CoManagedSharedWorkError();
    if (field === '*' || field === 'fields') return true;
    let path = field;
    while (path.startsWith('fields.') || path.startsWith('values.')) {
      path = path.slice(path.indexOf('.') + 1);
    }
    return names.some(name => path === name || path.startsWith(`${name}.`) || name.startsWith(`${path}.`));
  });
}
