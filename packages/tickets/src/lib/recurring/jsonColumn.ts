/** `jsonb` columns arrive parsed from pg but as strings from some drivers/fixtures; accept both. */
export function asJsonColumn<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
