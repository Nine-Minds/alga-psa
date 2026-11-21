import { getFlatTemplateExampleData } from "./templateVariables";

/** Get registry-backed sample data for a system email template. */
export function getTemplateSampleData(
  templateName: string,
): Record<string, string> {
  return getFlatTemplateExampleData(templateName);
}

/**
 * Extract placeholders as a defensive fallback for tenant-authored additions
 * that have not yet been added to the system template registry.
 */
export function extractVariablesFromTemplate(
  content: string,
): Record<string, string> {
  const variables: Record<string, string> = {};
  const regex = /\{{2,3}([^{}]+)\}{2,3}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const variableName = match[1].trim();
    if (
      variableName.startsWith("#") ||
      variableName.startsWith("/") ||
      variableName === "else" ||
      variableName.startsWith("else ") ||
      variableName.startsWith("this.")
    ) {
      continue;
    }
    if (!variables[variableName])
      variables[variableName] = formatVariableAsSample(variableName);
  }

  return variables;
}

function formatVariableAsSample(variableName: string): string {
  return variableName
    .split(".")
    .flatMap((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_\s]+/))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function getSampleDataForPreview(
  templateName: string,
  htmlContent: string,
  subject?: string,
): Record<string, string> {
  const extracted = extractVariablesFromTemplate(
    `${subject ?? ""} ${htmlContent}`,
  );
  return { ...extracted, ...getTemplateSampleData(templateName) };
}

/**
 * Expand {{#each path}}...{{/each}} blocks once for previews and test emails,
 * qualifying item references against the block's path when sample data exists.
 * One level only: sample data holds a single example item.
 */
export function expandEachBlocksForPreview(
  content: string,
  data: Record<string, string>,
): string {
  // The single example item is the first, so {{#unless @first}} blocks drop out.
  const withoutFirstGuards = content.replace(/\{\{#unless\s+@first\s*\}\}[\s\S]*?\{\{\/unless\}\}/g, '');
  return withoutFirstGuards.replace(
    /\{\{#each\s+([^{}\s]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, path: string, blockContent: string) =>
      blockContent.replace(
        /(\{{2,3})((?:#if|else\s+if)\s+)?(this\.)?([^\s{}]+)\s*(\}{2,3})/g,
        (inner, open: string, ifTag: string | undefined, thisPrefix: string | undefined, key: string, close: string) => {
          if (!ifTag && !thisPrefix && (key === 'else' || /^[#/@]/.test(key))) return inner;
          const samplePath = [`${path}[].${key}`, `${path}.${key}`].find(
            (candidate) => Object.hasOwn(data, candidate),
          );
          if (!samplePath && !thisPrefix) return inner;
          return `${open}${ifTag ?? ''}${samplePath ?? `${path}.${key}`}${close}`;
        },
      ),
  );
}

/** Expand innermost conditionals first so nested preview blocks keep their surrounding content. */
export function expandIfBlocksForPreview(
  content: string,
  show: (condition: string) => boolean = () => true,
): string {
  const innermostIf = /\{\{#if\s+([^{}]+)\}\}((?:(?!\{\{#if\s|\{\{\/if\}\})[\s\S])*)\{\{\/if\}\}/g;
  let result = content;
  while (innermostIf.test(result)) {
    innermostIf.lastIndex = 0;
    result = result.replace(innermostIf, (_match, condition: string, blockContent: string) => {
      const branches = blockContent.split(/\{\{else(?:\s+if\s+([^}]+?))?\s*\}\}/);
      if (show(condition.trim())) return branches[0];
      for (let index = 1; index < branches.length; index += 2) {
        const nextCondition = branches[index];
        if (nextCondition === undefined || show(nextCondition.trim())) return branches[index + 1] ?? '';
      }
      return '';
    });
  }
  return result;
}

/** Render a single sample row and substitute registry values for preview or test mail. */
export function replaceTemplateSampleVariables(
  content: string,
  data: Record<string, string>,
  show: (condition: string) => boolean = () => true,
): string {
  const expanded = expandIfBlocksForPreview(expandEachBlocksForPreview(content, data), show);
  return expanded.replace(/\{{2,3}([^{}]+)\}{2,3}/g, (match, key: string) => {
    const trimmedKey = key.trim();
    return Object.hasOwn(data, trimmedKey) ? data[trimmedKey] : match;
  });
}
