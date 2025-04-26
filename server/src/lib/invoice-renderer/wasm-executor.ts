import { init, Wasmer, Instance } from '@wasmer/sdk';
import { Buffer } from 'buffer'; // Ensure Buffer is available
import type { InvoiceViewModel, LayoutElement } from './types'; // Assuming LayoutElement is the root or part of the structure returned
import { createWasmerImportObject } from './host-functions';

// Placeholder Class ID for AssemblyScript's __new function.
// This might need adjustment based on the actual AS project setup.
// Often, the ID for String is 1, but complex objects might have others.
// We might need a way to get this dynamically or agree on a convention.
const AS_STRING_ID = 1; // Common ID for String in AS runtime loader
const AS_LAYOUT_STRUCTURE_ID = 0; // Placeholder - This needs to be the actual ID of the Layout Structure class in AS

/**
 * Executes the AssemblyScript Wasm template module.
 *
 * @param templateWasm - The buffer containing the compiled Wasm module.
 * @param invoiceData - The input data for the invoice template.
 * @returns A promise that resolves to the deserialized Layout Data Structure.
 * @throws If Wasm initialization, instantiation, or execution fails.
 */
export async function executeWasmTemplate(
  templateWasm: Buffer,
  invoiceData: InvoiceViewModel
): Promise<LayoutElement> { // Assuming LayoutElement is the root type returned
  // 1. Initialize Wasmer (if not already done globally)
  // Note: Calling init() multiple times is safe.
  await init();

  // 2. Prepare Import Object (Host Functions)
  // Security: Only provide absolutely necessary functions to the Wasm module.
  // Review host function implementations for potential vulnerabilities (e.g., unsanitized input).
  // The current 'log' function is low-risk.
  const importObject = createWasmerImportObject();

  // 3. Instantiate the Wasm module
  // Security: The @wasmer/sdk provides memory isolation. For stricter sandboxing
  // (CPU limits, memory caps, controlled filesystem access), consider using WASI
  // (@wasmer/wasi) and configuring the Wasmer runtime environment appropriately.
  // The JS SDK's direct control over these limits is currently limited.
  let instance: WebAssembly.Instance; // Use standard WebAssembly.Instance type
  try {
    // 1. Compile the Wasm bytes into a Module
    const module = await WebAssembly.compile(templateWasm);
    // 2. Instantiate the Module with the import object
    const result = await WebAssembly.instantiate(module, importObject);
    instance = result; // Assign the instance from the result

  } catch (error) {
    console.error('Error compiling or instantiating Wasm module:', error);
    throw new Error(`Wasm instantiation failed: ${error}`);
  }

  // 4. Get Wasm memory and exported functions
  // Access exports from the instantiated instance
  const exports = instance.exports;
  const memory = exports.memory as WebAssembly.Memory;
  // Assuming the main function is exported as 'generateLayout' based on boilerplate
  const wasmGenerateLayout = exports.generateLayout as (inputPtr: number) => number;
  const wasmAlloc = exports.__new as (size: number, classId: number) => number;
  const wasmUnpin = exports.__unpin as (ptr: number) => void;
  // const wasmPin = exports.__pin as (ptr: number) => void; // Use if needed

  // Update the check for the renamed function
  if (!memory || !wasmGenerateLayout || !wasmAlloc || !wasmUnpin) {
    // Check which specific export is missing for better error message
    const missing = [
        !memory && "memory",
        !wasmGenerateLayout && "generateLayout", // Check for the correct function name
        !wasmAlloc && "__new",
        !wasmUnpin && "__unpin"
    ].filter(Boolean).join(", ");
    throw new Error(`Required exports (${missing}) not found in Wasm module.`);
  }

  let inputPtr: number | null = null;
  let outputPtr: number | null = null;

  try {
    // 5. Serialize input data and write to Wasm memory
    const inputJson = JSON.stringify(invoiceData);
    const inputBuffer = Buffer.from(inputJson, 'utf8');

    // Allocate memory in Wasm for the input string
    inputPtr = wasmAlloc(inputBuffer.length, AS_STRING_ID);
    if (inputPtr === 0) {
      throw new Error('Wasm failed to allocate memory for input data.');
    }

    // Write the input buffer to Wasm memory
    const memoryView = new Uint8Array(memory.buffer);
    memoryView.set(inputBuffer, inputPtr);

    // 6. Call the Wasm entry point function (using the correct name)
    outputPtr = wasmGenerateLayout(inputPtr);
    if (outputPtr === 0) {
      // Check if 0 is a valid pointer or indicates an error in Wasm (as defined by the AS template)
      console.warn('Wasm render function returned pointer 0. Assuming null/empty result or potential error.');
      // Depending on convention, this might be an error or just an empty layout
      // For now, let's assume it means an empty document structure.
      // Adjust based on the actual Wasm implementation's error handling.
      // throw new Error('Wasm render function failed or returned null pointer.');
      // TODO: Define how Wasm signals errors (e.g., specific pointer value, host function call)
      // Returning a default empty document for now if ptr is 0
       return { type: 'Document', children: [] } as LayoutElement; // Cast needed
    }

    // 7. Read the serialized output data from Wasm memory
    // AssemblyScript strings/objects are typically stored with length prefix or null termination.
    // as-json likely returns a pointer to a standard AS string object.
    // We need to read the string content from memory.
    // The structure is often: [ 4 bytes: length | utf16 characters... ]
    // Or potentially UTF8 depending on AS/as-json config. Let's assume UTF8 for JSON.

    // Helper to read null-terminated UTF8 string from Wasm memory (common for C-like strings)
    // OR read AS string (length-prefixed UTF16) - AS strings are complex.
    // Let's assume the Wasm function returns a pointer to a UTF-8 encoded JSON string
    // managed by the AS runtime. We need a robust way to get its length and content.
    // A common pattern is for the Wasm function to return length separately or use a host func.
    // Simpler approach: Assume null-terminated UTF-8 string for now.
    // More robust: Use AS specific memory reading (requires knowledge of AS object layout)

    // --- Reading AssemblyScript String (More Complex & Accurate) ---
    // AS strings (UTF16 usually) have internal structure (headers). Reading them directly is tricky.
    // A common pattern is to have the Wasm export a helper like `getString(ptr)`
    // or rely on WASI/host functions to copy the string data out.

    // --- Simplified Reading (Assuming null-terminated UTF8 - Less likely for as-json) ---
    // let outputEnd = outputPtr;
    // while (memoryView[outputEnd] !== 0) {
    //   outputEnd++;
    // }
    // const outputBuffer = memoryView.slice(outputPtr, outputEnd);
    // const outputJson = Buffer.from(outputBuffer).toString('utf8');

    // --- Reading via __getString (Preferred if available) ---
    // This function is often part of the AS loader helpers but might not be exported by default.
    // If exported:
    // const wasmGetString = instance.exports.__getString as (ptr: number) => string;
    // if (!wasmGetString) throw new Error("__getString not exported");
    // const outputJson = wasmGetString(outputPtr);

    // --- Reading via Manual Length Lookup (If AS object layout is known) ---
    // AS String layout might be like: GC Header | Length (u32) | Characters (UTF16)
    // const outputDataView = new DataView(memory.buffer);
    // const outputLength = outputDataView.getUint32(outputPtr + OFFSET_TO_LENGTH, true); // Need correct offset & littleEndian
    // const outputBuffer = memoryView.slice(outputPtr + OFFSET_TO_DATA, outputPtr + OFFSET_TO_DATA + outputLength * 2); // *2 for UTF16
    // const outputJson = Buffer.from(outputBuffer).toString('utf16le');

    // --- Fallback/Placeholder: Using console log from AS ---
    // For initial testing, the AS code could just log the JSON string using the host `log` function.
    // This avoids complex memory reading for now.
    // Let's assume for now the pointer `outputPtr` points to a structure that `as-json` can handle
    // on the AS side, and we need a way to get the string representation.
    // A common way is to have the Wasm function return the *length* as well, or write it to memory.
    // Let's modify the plan slightly: Assume `render` returns a pointer, and we need another
    // exported function, e.g., `getOutputLength(ptr)` and modify `render` in AS later.
    // OR, the simplest: Assume `render` returns a pointer to a string allocated via `__new`,
    // and we can read it using a helper or known structure.

    // **Revised Approach: Assume `generateLayout` returns pointer to AS String, use `__getString` if exported, otherwise error.**
    // This requires the Wasm module to export `__getString`. If not, this will fail.
    const wasmGetString = exports.__getString as ((ptr: number) => string) | undefined;
    if (!wasmGetString) {
       console.warn("Wasm module does not export '__getString'. Cannot read output string. Returning empty document."); // Changed to warn
       // As a temporary measure, log a warning and return an empty structure.
       // This needs to be resolved by exporting __getString from the AS module or using another method.
       // throw new Error("Wasm module must export '__getString' to read output.");
       return { type: 'Document', children: [] } as LayoutElement; // Cast needed
    }
    const outputJson = wasmGetString(outputPtr);


    // 8. Deserialize the output data
    const layoutData = JSON.parse(outputJson) as LayoutElement; // Assuming root is LayoutElement

    return layoutData;

  } catch (error) {
    console.error('Error during Wasm execution:', error);
    throw new Error(`Wasm execution failed: ${error}`);
  } finally {
    // 9. Free Wasm memory
    // Use __unpin for memory managed by AS runtime's GC.
    // If memory was allocated with a different mechanism, use the corresponding free function.
    if (inputPtr !== null) {
      try {
        wasmUnpin(inputPtr);
      } catch (e) { console.error("Error unpinning input pointer:", e); }
    }
    if (outputPtr !== null) {
      try {
        wasmUnpin(outputPtr);
      } catch (e) { console.error("Error unpinning output pointer:", e); }
    }
    // Note: Instance disposal might be needed if not reusing the instance.
    // instance.dispose(); // Check Wasmer SDK docs for instance lifecycle management.

    // Security Cleanup: Although AS uses GC, explicitly nullifying references
    // after use can help ensure objects are eligible for collection sooner,
    // reducing the window for potential use-after-free issues if memory management
    // logic were flawed. (Minimal impact with current simple structure).
    inputPtr = null;
    outputPtr = null;
  }
}