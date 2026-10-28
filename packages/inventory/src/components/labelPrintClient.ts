export type LabelPrintResult =
  | { ok: true; url: string }
  | { ok: false; status: number; message: string; suggestedTemplateCode?: string };

// LEVERAGE: pattern label-print-client — C2 (print buttons) will need this same POST /api/labels/pdf
// client; no shared helper existed when C3 landed. Extract once a second caller exists.
/**
 * Render labels through `POST /api/labels/pdf` and return an object URL for the PDF.
 * Read-only on the server (no stock movements, no history rows). The caller opens the
 * URL and is responsible for `URL.revokeObjectURL`.
 */
export async function requestLabelPdf(input: {
  labelClass: string;
  labels: Array<{ recordId: string }>;
  templateCode?: string;
}): Promise<LabelPrintResult> {
  let response: Response;
  try {
    response = await fetch('/api/labels/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server to print this label.' };
  }
  if (response.ok) {
    return { ok: true, url: URL.createObjectURL(await response.blob()) };
  }
  let message = 'Could not print this label.';
  let suggestedTemplateCode: string | undefined;
  try {
    const body = (await response.json()) as {
      error?: string;
      failures?: Array<{ suggestedTemplateCode?: string }>;
    };
    if (body.error) message = body.error;
    suggestedTemplateCode = body.failures?.find((f) => f.suggestedTemplateCode)?.suggestedTemplateCode;
  } catch {
    /* non-JSON error body: keep the generic message */
  }
  return { ok: false, status: response.status, message, ...(suggestedTemplateCode ? { suggestedTemplateCode } : {}) };
}
