import { instantiate, type ASUtil } from "@assemblyscript/loader"; // Import loader
import { Buffer } from 'buffer';
import type { WasmInvoiceViewModel, LayoutElement } from '@alga-psa/types';
import { createWasmImportObject } from './host-functions'; // Correct import name
import * as fs from 'fs/promises';
import * as path from 'path';

// Type alias for the expected shape of the Wasm module's exports after loading
// Ensure it satisfies the loader's constraint by intersecting with Record<string, unknown>
type WasmTemplateModule = ASUtil & {
  generateLayout(inputPtr: number): number;
  // Add other specific exports if needed
} & Record<string, unknown>; // Satisfy the constraint


/**
 * Executes the AssemblyScript Wasm template module using @assemblyscript/loader.
 *
 * @param templateWasm - The buffer containing the compiled Wasm module.
 * @param invoiceData - The input data for the invoice template.
 * @returns A promise that resolves to the deserialized Layout Data Structure.
 * @throws If Wasm initialization, instantiation, or execution fails.
 */
export async function executeWasmTemplate(
  invoiceData: WasmInvoiceViewModel,
  templateWasm: Buffer
): Promise<LayoutElement> {
  // 1. Define a variable to hold the actual __getString function, initialized to a dummy
  let getStringFn: (ptr: number) => string = (ptr) => `[getString not available yet: ptr ${ptr}]`;

  // 2. Define the host functions that will close over getStringFn
  const logHostFn = (messagePtr: number): void => {
      try {
          const message = getStringFn(messagePtr);
          console.log(`[Wasm Log]: ${message}`);
      } catch (e: any) {
          console.error(`[Wasm Log Error]: Failed to get string at ptr ${messagePtr}: ${e.message}`);
          console.log(`[Wasm Log]: Raw Pointer: ${messagePtr}`); // Log raw pointer on error
      }
  };

  const abortHostFn = (messagePtr: number, fileNamePtr: number, lineNumber: number, columnNumber: number): void => {
      let message = `[Error getting message: ptr ${messagePtr}]`;
      let fileName = `[Error getting file: ptr ${fileNamePtr}]`;
      try { message = getStringFn(messagePtr); } catch (e) { /* Keep fallback */ }
      try { fileName = getStringFn(fileNamePtr); } catch (e) { /* Keep fallback */ }

      console.error(`[Wasm Abort]: Abort called from Wasm!`);
      console.error(`  File: ${fileName} (Ptr: ${fileNamePtr})`);
      console.error(`  Location: Line ${lineNumber}, Column ${columnNumber}`);
      console.error(`  Message: "${message}" (Ptr: ${messagePtr})`);
      throw new Error(`Wasm module aborted: "${message}" at ${fileName}:${lineNumber}:${columnNumber}`);
  };

  // 3. Create the import object, passing the host functions
  const imports = createWasmImportObject(logHostFn, abortHostFn);

  // Use a more specific type for the instance based on the loader's return type
  type WasmInstanceType = Awaited<ReturnType<typeof instantiate<WasmTemplateModule>>>;
  let instance: WasmInstanceType | null = null;

  try {
    // 4. Instantiate the Wasm module using the loader
    instance = await instantiate<WasmTemplateModule>(templateWasm, imports);

    // 5. Check if instantiation was successful
    if (!instance) {
        throw new Error("Wasm module instantiation returned null.");
    }

    // 6. NOW update the getStringFn variable to the *actual* function from the instance.
    // Subsequent calls to log/abort from Wasm will use this real function via the closure.
    getStringFn = instance.exports.__getString;

    // 7. Access Exports
    const exports = instance.exports; // Assign exports for convenience

    if (typeof exports.generateLayout !== 'function') {
        throw new Error(`Required export 'generateLayout' function not found in Wasm module.`);
    }

    // 8. Serialize input data
    const inputJson = JSON.stringify(invoiceData);
    console.log('Input JSON to WASM:', inputJson);

    // 9. Pass input string to Wasm using loader helper
    const inputPtr = exports.__newString(inputJson);

    // 10. Call the Wasm entry point function
    const outputPtr = exports.generateLayout(inputPtr);

    if (outputPtr === 0) {
      console.warn('Wasm generateLayout function returned pointer 0. Assuming null/empty result.');
      return { type: 'Document', children: [] } as LayoutElement;
    }

    // 11. Read the output string from Wasm using loader helper
    const outputJson = exports.__getString(outputPtr);

    console.log('Output JSON from WASM:', outputJson);

    // 12. Deserialize the output data
    const layoutData = JSON.parse(outputJson) as LayoutElement;

    return layoutData;

  } catch (error) {
    console.error('Error during Wasm instantiation or execution:', error);
    // More specific error handling can be added based on the error type
    if (error instanceof Error) {
        throw new Error(`Wasm execution failed: ${error.message}`);
    } else {
        throw new Error(`Wasm execution failed with unknown error: ${error}`);
    }
  } finally {
    // 9. Cleanup (Optional with Loader)
    // The loader's helpers (__newString, __getString) manage pinning/unpinning.
    // Explicitly calling __unpin is usually not needed for pointers obtained
    // from these helpers. The loader's runtime handles GC.
    // If you manually manage memory with __new, __pin, you'd need __unpin here.

    // Instance disposal might be relevant if the loader provides a mechanism,
    // but typically WebAssembly instances are garbage collected.
    // instance?.dispose(); // Check if loader offers disposal

    // Nullifying references can help GC, but less critical here.
  }
}
