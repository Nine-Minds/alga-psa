import { z } from 'zod';

const withoutDefault = (schema: z.ZodType): z.ZodType => {
  const def = schema._zod.def as { type: string; innerType?: z.ZodType };
  return (def.type === 'default' || def.type === 'prefault') && def.innerType ? withoutDefault(def.innerType) : schema;
};

/**
 * `.partial()` for update bodies. Zod 4 still fills a defaulted field when the key is absent,
 * which would turn every partial update into a reset of those fields; Zod 3 left absent keys out.
 */
export function partialWithoutDefaults<T extends z.ZodObject<any>>(schema: T): ReturnType<T['partial']> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, field]) => [key, withoutDefault(field)])
  );
  return schema.extend(shape).partial() as ReturnType<T['partial']>;
}
