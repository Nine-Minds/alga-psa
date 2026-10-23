import {
  resolveDefaultFieldFormat,
  resolveDocumentFieldLabel,
  resolveStandardFieldLabel,
} from './documentBindingCatalog';
import { isTranslatableValue } from '../utils/translatableText';

/** One metadata write of a rebind; `value: undefined` means "unset the key". */
export type DataFieldRebindPatch = { path: string; value: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A label is automatic while it is empty, the current binding's catalog name, or a
 * still-translated standard label; anything else was typed by the author and stays.
 */
export const labelFollowsBinding = (metadata: Record<string, unknown>, currentBinding: string): boolean => {
  const label = typeof metadata.label === 'string' ? metadata.label.trim() : '';
  return (
    label.length === 0 ||
    label === resolveDocumentFieldLabel(currentBinding.trim()) ||
    isTranslatableValue(label, metadata.__astLabelI18n)
  );
};

/**
 * The single policy for pointing a Data Field at a new binding, shared by the
 * inspector's binding picker and the FIELDS tab so they cannot drift apart.
 * Returns the metadata writes in order; the caller applies them as one undo step.
 *
 * - The format describes the data, so it always follows the binding.
 * - The label follows too unless the author typed their own: a standard label
 *   brings its translation ref along, any other binding gets its catalog label
 *   and loses a stale ref.
 */
export const planDataFieldRebind = (
  node: { props?: unknown } | undefined,
  nextBinding: string,
  catalogLabel?: string
): DataFieldRebindPatch[] => {
  const props = isRecord(node?.props) ? node.props : {};
  const metadata = isRecord(props.metadata) ? props.metadata : {};
  const currentBinding = typeof metadata.bindingKey === 'string' ? metadata.bindingKey.trim() : '';
  const patches: DataFieldRebindPatch[] = [];

  if (nextBinding !== currentBinding) {
    patches.push({ path: 'metadata.format', value: resolveDefaultFieldFormat(nextBinding) });
    if (labelFollowsBinding(metadata, currentBinding)) {
      const standardLabel = resolveStandardFieldLabel(nextBinding);
      if (standardLabel) {
        patches.push({ path: 'metadata.label', value: standardLabel.defaultValue });
        patches.push({ path: 'metadata.__astLabelI18n', value: standardLabel });
      } else {
        patches.push({ path: 'metadata.label', value: catalogLabel ?? resolveDocumentFieldLabel(nextBinding) });
        patches.push({ path: 'metadata.__astLabelI18n', value: undefined });
      }
    }
  }
  patches.push({ path: 'metadata.bindingKey', value: nextBinding });
  return patches;
};
