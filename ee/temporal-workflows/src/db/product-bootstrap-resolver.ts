import * as path from 'path';
import * as fs from 'fs/promises';

export type ProductCode = 'psa' | 'algadesk';

export interface ProductBootstrapPlan {
  productCode: ProductCode;
  seedDirectoryName: ProductCode;
}

const SUPPORTED_PRODUCT_CODES: ProductCode[] = ['psa', 'algadesk'];

export function normalizeProductCode(productCode?: string | null): ProductCode {
  if (!productCode) {
    return 'psa';
  }

  if (SUPPORTED_PRODUCT_CODES.includes(productCode as ProductCode)) {
    return productCode as ProductCode;
  }

  throw new Error(
    `Unsupported tenant product code "${productCode}" for onboarding bootstrap. Supported product codes: ${SUPPORTED_PRODUCT_CODES.join(', ')}`,
  );
}

export function resolveProductBootstrap(productCode?: string | null): ProductBootstrapPlan {
  const normalized = normalizeProductCode(productCode);
  return {
    productCode: normalized,
    seedDirectoryName: normalized,
  };
}

export function resolveProductSeedDirectory(input: {
  onboardingSeedsRoot: string;
  productCode?: string | null;
}): string {
  const plan = resolveProductBootstrap(input.productCode);
  return path.join(input.onboardingSeedsRoot, plan.seedDirectoryName);
}

export async function listProductSeedFiles(input: {
  onboardingSeedsRoot: string;
  productCode?: string | null;
}): Promise<string[]> {
  const seedsDir = resolveProductSeedDirectory(input);
  const files = await fs.readdir(seedsDir);

  return files
    .filter(file => file.toLowerCase().endsWith('.cjs'))
    .sort();
}
