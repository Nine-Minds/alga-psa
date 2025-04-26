import type { HostFunctions } from './types';

/**
 * Provides the host-side implementations for functions callable from Wasm.
 * These functions are passed to the Wasmer runtime during Wasm module instantiation.
 *
 * Security Note: Ensure any data passed from Wasm is properly validated and sanitized,
 * especially if functions perform sensitive operations or interact with external systems.
 * For now, the 'log' function is simple and relatively safe.
 */
export const hostFunctionsImplementation: HostFunctions = {
  /**
   * Logs a message received from the Wasm module to the host console.
   * @param message The string message sent from Wasm.
   */
  log: (message: string): void => {
    // Basic logging. Could be enhanced to use a proper logger (e.g., Winston)
    // and potentially prefix messages to indicate they came from Wasm.
    console.log(`[Wasm Log]: ${message}`);
  },

  // Add implementations for other minimal host functions here as needed.
  // Example:
  // formatCurrency: (amount: number, currencyCode: string): string => {
  //   // Implementation using Intl.NumberFormat or similar
  //   try {
  //     return new Intl.NumberFormat('en-US', { // Consider locale parameterization
  //       style: 'currency',
  //       currency: currencyCode,
  //     }).format(amount);
  //   } catch (error) {
  //     console.error(`[Wasm Host Error] formatCurrency failed:`, error);
  //     // Return a fallback or throw, depending on desired error handling
  //     return `${amount} ${currencyCode}`;
  //   }
  // },
};

/**
 * Helper function to prepare the import object for Wasmer.
 * This maps the host function implementations to the structure Wasmer expects.
 * The namespace ('env' by default in AssemblyScript) must match the Wasm module's imports.
 *
 * @param implementations - The object containing the host function implementations.
 * @returns The import object structure for Wasmer.
 */
export function createWasmerImportObject(
  implementations: HostFunctions = hostFunctionsImplementation
): Record<string, Record<string, WebAssembly.ImportValue>> {
  // AssemblyScript typically uses 'env' as the default import namespace.
  // If a different namespace is used in AS, update it here.
  const importNamespace = 'env';

  const wasmerImports: Record<string, WebAssembly.ImportValue> = {};

  // Map the implementation functions to the import object.
  // Wasmer/Wasm expects functions directly.
  for (const key in implementations) {
    if (Object.prototype.hasOwnProperty.call(implementations, key)) {
      // Type assertion needed as HostFunctions uses specific types,
      // but Wasmer expects generic WebAssembly.ImportValue.
      wasmerImports[key] = implementations[key as keyof HostFunctions] as WebAssembly.ImportValue;
    }
  }

  return {
    [importNamespace]: wasmerImports,
  };
}