declare namespace __AdaptedExports {
  /** Exported memory */
  export const memory: WebAssembly.Memory;
  /**
   * standard/standard-detailed/generateLayout
   * @param dataString `~lib/string/String`
   * @returns `~lib/string/String`
   */
  export function generateLayout(dataString: string): string;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;
