export interface AutocompleteSuggestion {
  path: string;
  label: string;
  type?: string;
  description?: string;
  hasChildren?: boolean;
  parentPath?: string;
}

const ROOT_TRIGGERS = ['payload', 'vars', 'meta', 'error', 'env', 'secrets', 'item', '$item', '$index'];

export function extractCurrentPath(
  expression: string,
  cursorPosition: number
): string | null {
  const textBeforeCursor = expression.slice(0, cursorPosition);
  const tokenBoundary = /[\s+\-*/%()[\]{},<>=!&|?:]/;
  let tokenStart = textBeforeCursor.length;

  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    if (tokenBoundary.test(textBeforeCursor[i])) {
      tokenStart = i + 1;
      break;
    }
    if (i === 0) {
      tokenStart = 0;
    }
  }

  const currentToken = textBeforeCursor.slice(tokenStart);

  if (!currentToken) return null;

  for (const trigger of ROOT_TRIGGERS) {
    if (currentToken.startsWith(trigger)) {
      return currentToken;
    }
  }

  return null;
}

export function filterSuggestions(
  allSuggestions: AutocompleteSuggestion[],
  currentPath: string | null
): AutocompleteSuggestion[] {
  if (!currentPath) return [];
  const maxResults = 20;

  const lowerPath = currentPath.toLowerCase();

  // If path ends with '.', show children at that level
  if (currentPath.endsWith('.')) {
    const parentPath = currentPath.slice(0, -1);
    const children = allSuggestions.filter(s =>
      s.path.toLowerCase().startsWith(parentPath.toLowerCase() + '.') &&
      s.path.split('.').length === parentPath.split('.').length + 1
    );
    if (children.length > 0) return children;

    const normalizedParent = parentPath.toLowerCase();
    if (normalizedParent === 'item' || normalizedParent === '$item') {
      const exactParent = allSuggestions.find(
        (suggestion) => suggestion.path.toLowerCase() === normalizedParent
      );
      return exactParent ? [exactParent] : [];
    }

    return [];
  }

  // Otherwise, filter by prefix match
  const pathParts = currentPath.split('.');
  const searchTerm = pathParts[pathParts.length - 1].toLowerCase();
  const parentPath = pathParts.slice(0, -1).join('.');

  // First priority: exact parent path with matching children
  const exactParentMatches = allSuggestions.filter(s => {
    const sParts = s.path.split('.');
    const sParent = sParts.slice(0, -1).join('.');
    const sLeaf = sParts[sParts.length - 1].toLowerCase();

    return sParent.toLowerCase() === parentPath.toLowerCase() &&
           sLeaf.startsWith(searchTerm);
  });

  if (exactParentMatches.length > 0) {
    return exactParentMatches
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, maxResults);
  }

  // Fallback: prefix match on full path
  return allSuggestions
    .filter(s => s.path.toLowerCase().startsWith(lowerPath))
    .sort((a, b) => a.path.length - b.path.length || a.label.localeCompare(b.label))
    .slice(0, maxResults);
}
