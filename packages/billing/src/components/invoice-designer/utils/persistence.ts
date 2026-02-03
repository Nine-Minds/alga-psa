import type { DesignerWorkspaceSnapshot } from '../state/designerStore';

const MARKER = 'ALGA_INVOICE_DESIGNER_STATE_V1';

type PersistedDesignerStateV1 = {
  version: 1;
  workspace: DesignerWorkspaceSnapshot;
};

const encodeBase64 = (value: string) => {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(unescape(encodeURIComponent(value)));
  }
  return Buffer.from(value, 'utf8').toString('base64');
};

const decodeBase64 = (value: string) => {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return decodeURIComponent(escape(window.atob(value)));
  }
  return Buffer.from(value, 'base64').toString('utf8');
};

const commentRegex = new RegExp(`/\\\\*\\\\s*${MARKER}:([A-Za-z0-9+/=]+)\\\\s*\\\\*/`, 'm');

export function extractInvoiceDesignerStateFromSource(source: string): PersistedDesignerStateV1 | null {
  if (typeof source !== 'string' || source.length === 0) {
    return null;
  }

  const match = source.match(commentRegex);
  if (!match?.[1]) {
    return null;
  }

  try {
    const decoded = decodeBase64(match[1]);
    const parsed = JSON.parse(decoded) as Partial<PersistedDesignerStateV1>;
    if (parsed?.version !== 1 || !parsed.workspace || !Array.isArray(parsed.workspace.nodes)) {
      return null;
    }
    return parsed as PersistedDesignerStateV1;
  } catch {
    return null;
  }
}

export function upsertInvoiceDesignerStateInSource(source: string, workspace: DesignerWorkspaceSnapshot): string {
  const payload: PersistedDesignerStateV1 = { version: 1, workspace };
  const encoded = encodeBase64(JSON.stringify(payload));
  const comment = `/* ${MARKER}:${encoded} */`;

  if (typeof source !== 'string' || source.length === 0) {
    // Important: do not introduce a non-empty source for brand new templates by default,
    // because the save action will attempt to compile non-empty AssemblyScript sources.
    return source;
  }

  if (commentRegex.test(source)) {
    return source.replace(commentRegex, comment);
  }

  const separator = source.endsWith('\n') ? '' : '\n';
  return `${source}${separator}${comment}\n`;
}

export function getInvoiceDesignerLocalStorageKey(templateId: string | null) {
  return `alga.invoiceDesigner.workspace.${templateId ?? 'new'}`;
}

