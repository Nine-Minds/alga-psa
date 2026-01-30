import type {
  CreateManualInvoiceInput,
  ExecuteRequest,
  ExecuteResponse,
  HostBindings,
  ManualInvoiceItemInput,
} from '@alga-psa/extension-runtime';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonResponse(body: unknown, init: Partial<ExecuteResponse> = {}): ExecuteResponse {
  const encoded = body instanceof Uint8Array ? body : encoder.encode(JSON.stringify(body));
  return {
    status: init.status ?? 200,
    headers: init.headers ?? [{ name: 'content-type', value: 'application/json' }],
    body: encoded,
  };
}

const BUILD_STAMP = '2026-01-14T00:00:00Z';

type FieldErrors = Record<string, string>;

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  try {
    return await processRequest(request, host);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'error', `[invoicing-demo] unhandled error build=${BUILD_STAMP} reason=${reason}`);
    return jsonResponse(
      {
        error: 'handler_failed',
        message: 'Invoicing demo handler encountered an unexpected error.',
        detail: reason,
        build: BUILD_STAMP,
      },
      { status: 500 }
    );
  }
}

async function processRequest(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  const method = request.http.method || 'GET';
  const url = request.http.url || '/';
  const requestId = request.context.requestId ?? 'n/a';
  const tenantId = request.context.tenantId;

  await safeLog(
    host,
    'info',
    `[invoicing-demo] request start tenant=${tenantId} requestId=${requestId} method=${method} url=${url} build=${BUILD_STAMP}`
  );

  if ((method === 'GET' || method === 'POST') && url.startsWith('/api/status')) {
    return jsonResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      tenant: request.context.tenantId,
      extension: request.context.extensionId,
      build: BUILD_STAMP,
    });
  }

  if (method === 'POST' && url.startsWith('/api/create-manual-invoice')) {
    return handleCreateManualInvoice(request, host);
  }

  return jsonResponse({ error: 'not_found', message: `No handler for ${method} ${url}` }, { status: 404 });
}

function decodeBody(body?: Uint8Array | null): string {
  if (!body || body.length === 0) return '';
  return decoder.decode(body);
}

function parseJsonBody(body?: Uint8Array | null): unknown {
  const text = decodeBody(body);
  if (!text) return null;
  return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateItem(value: unknown, index: number, errors: FieldErrors): ManualInvoiceItemInput | null {
  if (!isRecord(value)) {
    errors[`items.${index}`] = 'Item must be an object.';
    return null;
  }

  const serviceId = typeof value.serviceId === 'string' ? value.serviceId.trim() : '';
  const quantity = Number(value.quantity);
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const rate = Number(value.rate);

  if (!serviceId) errors[`items.${index}.serviceId`] = 'serviceId is required.';
  if (!Number.isFinite(quantity) || quantity <= 0) errors[`items.${index}.quantity`] = 'quantity must be > 0.';
  if (!description) errors[`items.${index}.description`] = 'description is required.';
  if (!Number.isFinite(rate) || rate < 0) errors[`items.${index}.rate`] = 'rate must be >= 0.';

  const isDiscount = typeof value.isDiscount === 'boolean' ? value.isDiscount : undefined;
  const discountType =
    value.discountType === 'percentage' || value.discountType === 'fixed' ? value.discountType : undefined;
  const appliesToItemId = typeof value.appliesToItemId === 'string' ? value.appliesToItemId : undefined;
  const appliesToServiceId = typeof value.appliesToServiceId === 'string' ? value.appliesToServiceId : undefined;

  return {
    serviceId,
    quantity,
    description,
    rate,
    ...(isDiscount !== undefined ? { isDiscount } : {}),
    ...(discountType ? { discountType } : {}),
    ...(appliesToItemId ? { appliesToItemId } : {}),
    ...(appliesToServiceId ? { appliesToServiceId } : {}),
  };
}

function validateCreateInput(payload: unknown): { ok: true; input: CreateManualInvoiceInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!isRecord(payload)) {
    return { ok: false, errors: { body: 'Request body must be a JSON object.' } };
  }

  const clientId = typeof payload.clientId === 'string' ? payload.clientId.trim() : '';
  if (!clientId) errors.clientId = 'clientId is required.';

  const rawItems = Array.isArray(payload.items) ? payload.items : null;
  if (!rawItems || rawItems.length === 0) {
    errors.items = 'items must be a non-empty array.';
  }

  const items: ManualInvoiceItemInput[] = [];
  if (rawItems) {
    rawItems.forEach((item, idx) => {
      const validated = validateItem(item, idx, errors);
      if (validated) items.push(validated);
    });
  }

  const invoiceDate = typeof payload.invoiceDate === 'string' ? payload.invoiceDate : undefined;
  const dueDate = typeof payload.dueDate === 'string' ? payload.dueDate : undefined;
  const poNumber =
    payload.poNumber === null ? null : typeof payload.poNumber === 'string' ? payload.poNumber : undefined;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      clientId,
      items,
      ...(invoiceDate ? { invoiceDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(poNumber !== undefined ? { poNumber } : {}),
    },
  };
}

async function handleCreateManualInvoice(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  let payload: unknown;
  try {
    payload = parseJsonBody(request.http.body ?? null);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await safeLog(host, 'warn', `[invoicing-demo] invalid JSON body; reason=${reason}`);
    return jsonResponse(
      { error: 'invalid_json', message: 'Request body must be valid JSON.', detail: reason, build: BUILD_STAMP },
      { status: 400 }
    );
  }

  const validated = validateCreateInput(payload);
  if (!validated.ok) {
    return jsonResponse(
      { success: false, error: 'validation_failed', fieldErrors: validated.errors, build: BUILD_STAMP },
      { status: 400 }
    );
  }

  const result = await host.invoicing.createManualInvoice(validated.input);
  if (!result.success) {
    return jsonResponse({ ...result, build: BUILD_STAMP }, { status: 400 });
  }

  return jsonResponse({ ...result, build: BUILD_STAMP });
}

async function safeLog(host: HostBindings, level: 'info' | 'warn' | 'error', message: string) {
  try {
    await host.logging[level](message);
  } catch {
    // Swallow logging errors to avoid cascading failures.
  }
}

