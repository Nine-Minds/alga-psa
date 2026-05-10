const SCOPED_SAVE_AS_PREFIXES = ['payload.', 'vars.', 'meta.', 'error.', '/'] as const;
const RESERVED_BARE_SAVE_AS_NAMES = new Set(['payload', 'vars', 'meta', 'error', 'env', 'secrets', 'item', '$index']);
const SAFE_DOT_PATH_SEGMENT_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export type WorkflowSaveAsValidation = {
  type: 'error' | 'warning';
  message: string;
} | null;

export const normalizeWorkflowSaveAsPath = (saveAs: string | undefined | null): string => {
  const trimmed = saveAs?.trim() ?? '';
  if (!trimmed) return '';

  return SCOPED_SAVE_AS_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
    ? trimmed
    : `vars.${trimmed}`;
};

export const getWorkflowSaveAsDisplayPath = (saveAs: string | undefined | null): string =>
  normalizeWorkflowSaveAsPath(saveAs);

export const isWorkflowSaveAsJsonPointer = (saveAs: string | undefined | null): boolean =>
  (saveAs?.trim() ?? '').startsWith('/');

export const getWorkflowSaveAsRoot = (saveAs: string | undefined | null): string | null => {
  const normalized = normalizeWorkflowSaveAsPath(saveAs);
  if (!normalized) return null;
  if (normalized.startsWith('/')) return 'payload';
  const [root] = normalized.split('.');
  return root || null;
};

export const validateWorkflowSaveAsPathShape = (saveAs: string | undefined | null): WorkflowSaveAsValidation => {
  const trimmed = saveAs?.trim() ?? '';
  if (!trimmed) return null;

  if (RESERVED_BARE_SAVE_AS_NAMES.has(trimmed)) {
    return {
      type: 'error',
      message: `"${trimmed}" is a reserved variable name`,
    };
  }

  if (trimmed.startsWith('/')) {
    if (trimmed === '/') {
      return {
        type: 'error',
        message: 'JSON pointer save paths must target a payload field',
      };
    }
    return null;
  }

  const normalized = normalizeWorkflowSaveAsPath(trimmed);
  const [root, ...segments] = normalized.split('.').filter(Boolean);
  if (!root || !['payload', 'vars', 'meta', 'error'].includes(root) || segments.length === 0) {
    return {
      type: 'error',
      message: 'Save output path must be a variable name or a scoped path such as payload.result',
    };
  }

  if (segments.some((segment) => !SAFE_DOT_PATH_SEGMENT_PATTERN.test(segment))) {
    return {
      type: 'warning',
      message: 'Path segments should start with a letter and contain only letters, numbers, and underscores',
    };
  }

  return null;
};
