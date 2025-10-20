export {};

/**
 * Sample workflow: create a service catalog entry and then generate a manual invoice
 * that references the new service.
 *
 * Usage:
 *   ALGA_API_URL="https://algapsa.com" \
 *   ALGA_API_KEY="your-api-key" \
 *   ALGA_TENANT_ID="your-tenant-id" \
 *   npm run sample:create-service-manual-invoice -- \
 *     --client-id "uuid-of-client" \
 *     --service-name "External Monitoring" \
 *     --service-type-id "uuid-of-service-type" \
 *     --billing-method fixed \
 *     --unit each \
 *     --rate 150.50 \
 *     --quantity 1
 *
 * Flags:
 *   --client-id           Required. UUID of the client that should receive the manual invoice.
 *   --service-name        Optional. Defaults to "Sample Service <timestamp>".
 *   --service-type-id     Optional. Existing custom service type UUID. When omitted the script
 *                         tries to reuse the type from the first service returned by GET /services.
 *   --billing-method      Optional. One of fixed | hourly | usage. Defaults to fixed.
 *   --unit                Optional. Unit of measure for the service (defaults to "each").
 *   --rate                Optional. Dollar amount for the service default rate and invoice line
 *                         (e.g. "150" or "150.50"). Converted to cents automatically. Mutually
 *                         exclusive with --rate-cents.
 *   --rate-cents          Optional. Integer cents value (e.g. 15000). Overrides --rate when provided.
 *   --quantity            Optional. Quantity for the manual invoice line (defaults to 1).
 *   --invoice-description Optional. Custom manual invoice line description. Defaults to
 *                         "Manual charge for <service-name>".
 *   --service-description Optional. Description stored on the service catalog item.
 *   --tax-rate-id         Optional. UUID of an existing tax rate to attach to the service.
 *   --category-id         Optional. UUID of a service category to assign.
 */

const API_BASE_URL = process.env.ALGA_API_URL ?? "https://algapsa.com";
const API_KEY = process.env.ALGA_API_KEY;
const TENANT_ID = process.env.ALGA_TENANT_ID;

if (!API_KEY) {
  console.error("Missing ALGA_API_KEY environment variable");
  process.exit(1);
}

type BillingMethod = "fixed" | "hourly" | "usage";

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  meta?: unknown;
}

interface ServiceResponse {
  service_id: string;
  service_name: string;
  custom_service_type_id: string;
  billing_method: BillingMethod;
  default_rate: number;
  unit_of_measure: string;
  category_id: string | null;
  tax_rate_id: string | null;
  description: string | null;
  tenant: string;
  service_type_name?: string;
  created_at?: string;
  updated_at?: string;
}

interface ApiSuccessResponse<T> {
  data: T;
  meta?: unknown;
}

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  } | string;
  [key: string]: unknown;
}

interface ManualInvoiceResponse {
  invoice_id: string;
  invoice_number: string;
  client_id: string;
  status: string;
  subtotal: number;
  tax: number;
  total_amount: number;
  is_manual: boolean;
}

interface ManualInvoiceLine {
  service_id: string;
  quantity: number;
  description: string;
  rate: number;
}

type FlagMap = Record<string, string>;

function parseFlags(): FlagMap {
  const flags: FlagMap = {};
  const argv = process.argv.slice(2);

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      console.error(`Missing value for flag --${key}`);
      process.exit(1);
    }

    flags[key] = value;
    index += 1;
  }

  return flags;
}

function parseCents(flags: FlagMap): number {
  if (flags["rate-cents"]) {
    const cents = Number(flags["rate-cents"]);
    if (!Number.isFinite(cents) || cents < 0) {
      throw new Error(`Invalid --rate-cents value: ${flags["rate-cents"]}`);
    }
    return Math.round(cents);
  }

  const raw = flags["rate"] ?? "150";
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || asNumber < 0) {
    throw new Error(`Invalid --rate value: ${raw}`);
  }

  return Math.round(asNumber * 100);
}

function parseQuantity(flags: FlagMap): number {
  const raw = flags["quantity"] ?? "1";
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Invalid --quantity value: ${raw}`);
  }
  return quantity;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...init?.headers,
    "x-api-key": API_KEY!,
  };

  if (TENANT_ID) {
    headers["x-tenant-id"] = TENANT_ID;
  }

  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

async function ensureServiceTypeId(flags: FlagMap): Promise<string> {
  if (flags["service-type-id"]) {
    return flags["service-type-id"];
  }

  const response = await apiRequest<PaginatedResponse<ServiceResponse>>(
    "/api/v1/services?limit=1"
  );

  if (!response.ok) {
    const detail = await safeJson<ApiErrorResponse>(response);
    throw new Error(
      `Unable to infer service type. GET /api/v1/services failed: ${response.status} ${response.statusText} – ${describeError(detail)}`
    );
  }

  const payload = (await response.json()) as PaginatedResponse<ServiceResponse>;
  const first = payload.data?.[0];
  if (!first?.custom_service_type_id) {
    throw new Error(
      "No existing services found. Provide --service-type-id so the script knows which service type to use."
    );
  }

  return first.custom_service_type_id;
}

async function createService(flags: FlagMap, serviceTypeId: string, defaultRate: number) {
  const billingMethod = (flags["billing-method"] ?? "fixed") as BillingMethod;
  if (!["fixed", "hourly", "usage"].includes(billingMethod)) {
    throw new Error(`Invalid --billing-method value: ${flags["billing-method"]}`);
  }

  const servicePayload: Record<string, unknown> = {
    service_name: flags["service-name"] ?? `Sample Service ${Date.now()}`,
    custom_service_type_id: serviceTypeId,
    billing_method: billingMethod,
    default_rate: defaultRate,
    unit_of_measure: flags["unit"] ?? "each",
  };

  if (flags["service-description"]) {
    servicePayload.description = flags["service-description"];
  }

  if (flags["tax-rate-id"]) {
    servicePayload.tax_rate_id = flags["tax-rate-id"];
  }

  if (flags["category-id"]) {
    servicePayload.category_id = flags["category-id"];
  }

  const response = await apiRequest<ApiSuccessResponse<ServiceResponse>>("/api/v1/services", {
    method: "POST",
    body: JSON.stringify(servicePayload),
  });

  if (!response.ok) {
    const detail = await safeJson<ApiErrorResponse>(response);
    throw new Error(
      `Service creation failed: ${response.status} ${response.statusText} – ${describeError(detail)}`
    );
  }

  const body = (await response.json()) as ApiSuccessResponse<ServiceResponse>;
  return body.data;
}

async function createManualInvoice(
  clientId: string,
  line: ManualInvoiceLine
): Promise<ManualInvoiceResponse> {
  const payload = {
    clientId,
    items: [line],
  };

  const response = await apiRequest<ApiSuccessResponse<ManualInvoiceResponse>>("/api/v1/invoices/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await safeJson<ApiErrorResponse>(response);
    throw new Error(
      `Manual invoice creation failed: ${response.status} ${response.statusText} – ${describeError(detail)}`
    );
  }

  const body = (await response.json()) as ApiSuccessResponse<ManualInvoiceResponse>;
  return body.data;
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    void error;
    return null;
  }
}

function describeError(payload: ApiErrorResponse | null): string {
  if (!payload) {
    return "No error payload returned";
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (payload.error?.message) {
    return payload.error.message;
  }

  return JSON.stringify(payload);
}

(async () => {
  try {
    const flags = parseFlags();
    const clientId = flags["client-id"];

    if (!clientId) {
      console.error("Missing required --client-id flag");
      process.exit(1);
    }

    const defaultRate = parseCents(flags);
    const quantity = parseQuantity(flags);
    const serviceTypeId = await ensureServiceTypeId(flags);

    const service = await createService(flags, serviceTypeId, defaultRate);
    const invoiceDescription =
      flags["invoice-description"] ?? `Manual charge for ${service.service_name}`;

    const invoice = await createManualInvoice(clientId, {
      service_id: service.service_id,
      quantity,
      description: invoiceDescription,
      rate: defaultRate,
    });

    console.log("Created service catalog entry:");
    console.log(JSON.stringify(service, null, 2));

    console.log("\nCreated manual invoice:");
    console.log(JSON.stringify(invoice, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();

