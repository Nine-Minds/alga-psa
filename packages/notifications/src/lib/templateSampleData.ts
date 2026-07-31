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
