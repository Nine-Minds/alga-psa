import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** A redacted source also hides its derived value; nested and parent paths
 * hide the whole candidate rather than return partially identifying objects. */
export function isCoManagedReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  return redactions.some(field => {
    if (typeof field !== 'string') throw new CoManagedSharedWorkError();
    if (field === '*' || field === 'fields') return true;
    const path = field.startsWith('fields.') ? field.slice(7) : field;
    const segments = path.split('.');
    return names.some(name => {
      const source = name.split('.');
      // '*' spans zero or more whole segments, including an omitted collection
      // index: tasks.*.due_date covers tasks.due_date and tasks.0.due_date.
      // A literal descendant hides its containing source. A wildcard alone
      // cannot consume that source and discard a remaining literal suffix:
      // *.due_date must not hide task_name or tasks.task_name.
      let next = Array<boolean>(source.length + 1).fill(true);
      for (let i = segments.length - 1; i >= 0; i--) {
        const current = Array<boolean>(source.length + 1).fill(false);
        for (let j = source.length - 1; j >= 0; j--) {
          current[j] = segments[i] === '*'
            ? next[j] || current[j + 1]
            : segments[i] === source[j] && (j + 1 === source.length || next[j + 1]);
        }
        next = current;
      }
      return next[0];
    });
  });
}
