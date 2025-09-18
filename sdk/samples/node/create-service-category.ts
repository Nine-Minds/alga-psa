/**
 * Standalone sample: create a service category via the Alga PSA API.
 *
 * Usage:
 *   ALGA_API_URL="https://algapsa.com" \
 *   ALGA_API_KEY="your-api-key" \
 *   ALGA_TENANT_ID="optional-tenant" \
 *   npm run sample:create-service-category -- "New Category Name"
 *
 * Pass the desired category name as the first CLI argument; defaults to
 * "Sample Service Category" when omitted.
 */

// Public production API is served from the main domain (no api. subdomain).
const API_BASE_URL = process.env.ALGA_API_URL ?? "https://algapsa.com";
const API_KEY = process.env.ALGA_API_KEY;
const TENANT_ID = process.env.ALGA_TENANT_ID;

if (!API_KEY) {
  console.error("Missing ALGA_API_KEY environment variable");
  process.exit(1);
}

const categoryName = process.argv[2] ?? "Sample Service Category";

interface CreateServiceCategoryInput {
  category_name: string;
  description?: string;
  is_active?: boolean;
}

interface ServiceCategoryResponse {
  category_id: string;
  category_name: string;
  description: string | null;
  is_active: boolean;
  tenant: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

async function createServiceCategory(input: CreateServiceCategoryInput): Promise<ServiceCategoryResponse> {
  const res = await fetch(`${API_BASE_URL}/api/v1/categories/service`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...(TENANT_ID ? { "x-tenant-id": TENANT_ID } : {}),
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Service category creation failed: ${res.status} ${res.statusText} – ${detail}`);
  }

  return (await res.json()) as ServiceCategoryResponse;
}

(async () => {
  try {
    const category = await createServiceCategory({
      category_name: categoryName,
      description: "Created via SDK sample script",
      is_active: true,
    });

    console.log("Created service category:");
    console.log(JSON.stringify(category, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
