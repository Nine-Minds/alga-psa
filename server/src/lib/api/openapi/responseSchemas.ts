import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from './registry';

export const OpenApiMetaSchema = zOpenApi.record(zOpenApi.unknown());

export const OpenApiPaginationSchema = zOpenApi.object({
  page: zOpenApi.number().int(),
  limit: zOpenApi.number().int(),
  total: zOpenApi.number().int(),
  totalPages: zOpenApi.number().int(),
  hasNext: zOpenApi.boolean(),
  hasPrev: zOpenApi.boolean(),
});

export function registerSuccessEnvelope<TData extends ZodTypeAny>(
  registry: ApiOpenApiRegistry,
  name: string,
  dataSchema: TData,
  options?: { metaSchema?: ZodTypeAny; includeMeta?: boolean },
) {
  return registry.registerSchema(
    name,
    zOpenApi.object({
      data: dataSchema,
      ...(options?.includeMeta === false
        ? {}
        : { meta: (options?.metaSchema ?? OpenApiMetaSchema).optional() }),
    }),
  );
}

export function registerArrayEnvelope<TItem extends ZodTypeAny>(
  registry: ApiOpenApiRegistry,
  name: string,
  itemSchema: TItem,
  options?: { metaSchema?: ZodTypeAny; includeMeta?: boolean },
) {
  return registerSuccessEnvelope(registry, name, zOpenApi.array(itemSchema), options);
}

export function registerPaginatedEnvelope<TItem extends ZodTypeAny>(
  registry: ApiOpenApiRegistry,
  name: string,
  itemSchema: TItem,
  options?: { metaSchema?: ZodTypeAny; includeMeta?: boolean },
) {
  return registry.registerSchema(
    name,
    zOpenApi.object({
      data: zOpenApi.array(itemSchema),
      pagination: OpenApiPaginationSchema,
      ...(options?.includeMeta === false
        ? {}
        : { meta: (options?.metaSchema ?? OpenApiMetaSchema).optional() }),
    }),
  );
}
