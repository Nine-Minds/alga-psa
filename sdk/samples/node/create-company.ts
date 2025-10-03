export {};

/**
 * Standalone sample: create a client via the Alga PSA API.
 *
 * Usage:
 *   ALGA_API_URL="https://algapsa.com" \\
 *   ALGA_API_KEY="your-api-key" \\
 *   ALGA_TENANT_ID="your-tenant-id" \\
 *   npm run sample:create-client -- \\
 *     --name "Example Client" \\
 *     --phone "+1 555 0100" \\
 *     --url "https://example.com" \\
 *     --billing-cycle "monthly" \\
 *     --email "hello@example.com" \\
 *     --account-manager "Ada Lovelace"
 *
 * Notes:
 * - Required fields (name, phone, URL, billing cycle) can be provided via CLI flags.
 * - There are currently no required foreign key IDs for client creation, but this
 *   sample demonstrates how to accept a human-friendly value (e.g. account manager
 *   name or email) and resolve it to an ID automatically when supplied.
 */

type BillingCycle =
  | "weekly"
  | "bi-weekly"
  | "monthly"
  | "quarterly"
  | "semi-annually"
  | "annually";

interface CreateClientInput {
  client_name: string;
  phone_no: string;
  url: string;
  billing_cycle: BillingCycle;
  email?: string;
  client_type?: string;
  account_manager_id?: string;
  notes?: string;
  tags?: string[];
}

interface ApiSuccessResponse<T> {
  data: T;
  pagination?: unknown;
  meta?: unknown;
}

interface ClientResponse {
  client_id: string;
  client_name: string;
  phone_no: string | null;
  email: string | null;
  url: string | null;
  billing_cycle: BillingCycle;
  tenant: string;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface UserSearchResult {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  username: string;
  [key: string]: unknown;
}

const API_BASE_URL = process.env.ALGA_API_URL ?? "https://algapsa.com";
const API_KEY = process.env.ALGA_API_KEY;
const TENANT_ID = process.env.ALGA_TENANT_ID;

if (!API_KEY) {
  console.error("Missing ALGA_API_KEY environment variable");
  process.exit(1);
}

/**
 * Minimal CLI flag parser (expects `--flag value` pairs).
 */
function parseFlags(): Record<string, string> {
  const flags: Record<string, string> = {};
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

async function resolveAccountManagerId(query: string): Promise<string> {
  const params = new URLSearchParams({ query, limit: "1" });
  const headers: Record<string, string> = {
    "x-api-key": API_KEY!,
  };

  if (TENANT_ID) {
    headers["x-tenant-id"] = TENANT_ID;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/users/search?${params.toString()}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to resolve account manager: ${response.status} ${response.statusText} – ${detail}`);
  }

  const payload = (await response.json()) as ApiSuccessResponse<UserSearchResult[]>;
  const match = payload.data?.[0];

  if (!match) {
    throw new Error(`No users matched the account manager query: "${query}"`);
  }

  return match.user_id;
}

async function createClient(input: CreateClientInput): Promise<ClientResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY!,
  };

  if (TENANT_ID) {
    headers["x-tenant-id"] = TENANT_ID;
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/clients`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Client creation failed: ${response.status} ${response.statusText} – ${detail}`);
  }

  const payload = (await response.json()) as ApiSuccessResponse<ClientResponse>;
  return payload.data;
}

(async () => {
  const flags = parseFlags();

  const billingCycle = (flags["billing-cycle"] as BillingCycle | undefined) ?? "monthly";
  const allowedCycles: BillingCycle[] = [
    "weekly",
    "bi-weekly",
    "monthly",
    "quarterly",
    "semi-annually",
    "annually",
  ];

  if (!allowedCycles.includes(billingCycle)) {
    console.error(`Invalid billing cycle: ${billingCycle}. Allowed values: ${allowedCycles.join(", ")}`);
    process.exit(1);
  }

  const clientName = flags.name ?? "Sample API Client";
  const phoneNumber = flags.phone ?? "+1 555 0100";
  const url = flags.url ?? "https://example.com";
  const email = flags.email;
  const clientType = flags["client-type"];
  const notes = flags.notes;
  const tags = flags.tags ? flags.tags.split(",").map(tag => tag.trim()).filter(Boolean) : undefined;

  const input: CreateClientInput = {
    client_name: clientName,
    phone_no: phoneNumber,
    url,
    billing_cycle: billingCycle,
    email,
    client_type: clientType,
    notes,
    tags,
  };

  const accountManagerQuery = flags["account-manager"];
  if (accountManagerQuery) {
    try {
      input.account_manager_id = await resolveAccountManagerId(accountManagerQuery);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  try {
    const client = await createClient(input);
    console.log("Created client:");
    console.log(JSON.stringify(client, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
