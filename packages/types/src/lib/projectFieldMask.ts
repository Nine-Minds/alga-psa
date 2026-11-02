/** Shared field-path matching for project redaction consumers. */
export function isProjectReadFieldHidden(redactions: readonly string[], names: readonly string[]): boolean {
  return redactions.some((field) => {
    if (typeof field !== 'string') throw new TypeError('Project redactions must be strings.');
    if (field === '*' || field === 'fields') return true;
    const path = field.startsWith('fields.') ? field.slice(7) : field;
    return names.some((name) => path === name || path.startsWith(`${name}.`) || name.startsWith(`${path}.`));
  });
}

/** Project tags are omitted when their collection or any displayed mapping field is hidden. */
export function coManagedProjectTagsHidden(redactedFields: readonly string[]): boolean {
  const fields = redactedFields.map((field) => field.trim().toLowerCase());
  return isProjectReadFieldHidden(fields, ['tags', 'values.tags', 'projects.tags', 'project.tags'])
    || ['tag_text', 'background_color', 'text_color'].some((field) =>
      isProjectReadFieldHidden(fields, [field, `values.${field}`, `project_tags.${field}`, `tags`, `tags.${field}`]));
}
