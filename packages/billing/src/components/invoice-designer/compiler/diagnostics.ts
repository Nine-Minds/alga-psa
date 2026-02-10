import type { InvoiceDesignerSourceMapEntry } from './assemblyScriptGenerator';

export type AssemblyScriptDiagnosticSeverity = 'error' | 'warning';

export type ParsedAssemblyScriptDiagnostic = {
  severity: AssemblyScriptDiagnosticSeverity;
  message: string;
  line: number | null;
  column: number | null;
  raw: string;
};

export type GuiLinkedAssemblyScriptDiagnostic = ParsedAssemblyScriptDiagnostic & {
  nodeId: string | null;
  symbol: string | null;
};

const parseLineColumn = (raw: string): { line: number | null; column: number | null } => {
  const colonPattern = /:(\d+):(\d+)/;
  const colonMatch = raw.match(colonPattern);
  if (colonMatch?.[1] && colonMatch[2]) {
    return {
      line: Number(colonMatch[1]),
      column: Number(colonMatch[2]),
    };
  }

  const tuplePattern = /\((\d+),\s*(\d+)\)/;
  const tupleMatch = raw.match(tuplePattern);
  if (tupleMatch?.[1] && tupleMatch[2]) {
    return {
      line: Number(tupleMatch[1]),
      column: Number(tupleMatch[2]),
    };
  }

  return {
    line: null,
    column: null,
  };
};

const normalizeDiagnosticMessage = (raw: string): string => {
  const withoutLocationPrefix = raw.replace(/^.*?:\d+:\d+\s*/g, '').trim();
  if (withoutLocationPrefix.length > 0) {
    return withoutLocationPrefix;
  }
  return raw.trim();
};

export const parseAssemblyScriptDiagnostics = (compilerOutput: string): ParsedAssemblyScriptDiagnostic[] => {
  if (typeof compilerOutput !== 'string' || compilerOutput.trim().length === 0) {
    return [];
  }

  return compilerOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => /\b(error|warning)\b/i.test(line))
    .map((line) => {
      const severity: AssemblyScriptDiagnosticSeverity = /\bwarning\b/i.test(line) ? 'warning' : 'error';
      const location = parseLineColumn(line);
      return {
        severity,
        message: normalizeDiagnosticMessage(line),
        line: Number.isFinite(location.line) ? location.line : null,
        column: Number.isFinite(location.column) ? location.column : null,
        raw: line,
      };
    });
};

const resolveSourceMapEntry = (
  line: number | null,
  sourceMap: InvoiceDesignerSourceMapEntry[]
): InvoiceDesignerSourceMapEntry | null => {
  if (!line || sourceMap.length === 0) {
    return null;
  }

  const containingEntries = sourceMap
    .filter((entry) => line >= entry.startLine && line <= entry.endLine)
    .sort((left, right) => {
      const leftWidth = left.endLine - left.startLine;
      const rightWidth = right.endLine - right.startLine;
      return leftWidth - rightWidth || left.startLine - right.startLine;
    });

  return containingEntries[0] ?? null;
};

export const linkDiagnosticsToGuiNodes = (
  diagnostics: ParsedAssemblyScriptDiagnostic[],
  sourceMap: InvoiceDesignerSourceMapEntry[]
): GuiLinkedAssemblyScriptDiagnostic[] =>
  diagnostics.map((diagnostic) => {
    const sourceMapEntry = resolveSourceMapEntry(diagnostic.line, sourceMap);
    return {
      ...diagnostic,
      nodeId: sourceMapEntry?.nodeId ?? null,
      symbol: sourceMapEntry?.symbol ?? null,
    };
  });
