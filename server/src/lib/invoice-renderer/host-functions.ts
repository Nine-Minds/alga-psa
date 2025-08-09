/**
 * Creates the import object for the Wasm module, adding provided host functions.
 *
 * @param logFn - The host function implementation for 'env.log'.
 * @param abortFn - The host function implementation for 'env.abort'.
 * @returns The import object structure suitable for `@assemblyscript/loader`.
 */
export function createWasmImportObject(
    logFn: (ptr: number) => void,
    abortFn: (msgPtr: number, filePtr: number, line: number, col: number) => void
): Record<string, Record<string, WebAssembly.ImportValue>> {

    // Define any other *truly* custom host functions here if needed
    const customHostFunctions = {
        // Example: myCustomFunction: () => { ... }
    };

    const importNamespace = 'env';

    // Start with the required log and abort functions
    const envImports: Record<string, WebAssembly.ImportValue> = {
        log: logFn as WebAssembly.ImportValue,
        abort: abortFn as WebAssembly.ImportValue,
    };

    // Assign any other custom host functions to the env namespace
    for (const key in customHostFunctions) {
        if (Object.prototype.hasOwnProperty.call(customHostFunctions, key)) {
            envImports[key] = customHostFunctions[key as keyof typeof customHostFunctions] as WebAssembly.ImportValue;
        }
    }

    // Construct the final import object
    const importObject: Record<string, Record<string, WebAssembly.ImportValue>> = {
        [importNamespace]: envImports,
        // Add the 'types' module with the log function
        types: {
            log: logFn as WebAssembly.ImportValue
        }
    };

    // The loader will merge its own required imports (e.g., for memory, GC).
    return importObject;
}