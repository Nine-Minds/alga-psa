/**
 * Matches a field redaction against its source aliases. A redaction of a parent
 * or child path hides the candidate, as do whole-field and wildcard rules.
 */
export function isFieldHiddenByRedaction(redactions: readonly string[], names: readonly string[]): boolean {
  return redactions.some((field) => {
    if (typeof field !== 'string') throw new TypeError('Redacted field entries must be strings');
    if (field === '*' || field === 'fields') return true;
    const path = field.startsWith('fields.') ? field.slice(7) : field;
    return names.some((name) => path === name || path.startsWith(`${name}.`) || name.startsWith(`${path}.`));
  });
}

/** Matches whole-resource redactions without treating a nested field as a resource mask. */
export function isResourceHiddenByRedaction(redactions: readonly string[], resources: readonly string[]): boolean {
  return redactions.some((field) => {
    if (typeof field !== 'string') throw new TypeError('Redacted field entries must be strings');
    if (field === '*' || field === 'fields') return true;
    return resources.includes(field.startsWith('fields.') ? field.slice(7) : field);
  });
}
