// Provides a basic abort implementation for AssemblyScript builds
// See: https://www.assemblyscript.org/compiler.html#compiler-options (--use)

// @ts-ignore: decorator is valid
@external("env", "abort") // Assuming host provides 'abort' in 'env' module
declare function hostAbort(message: string | null, fileName: string | null, lineNumber: u32, columnNumber: u32): void;

// This function will be called by AssemblyScript on assertion failures or explicit aborts
export function abort(message: string | null, fileName: string | null, lineNumber: u32, columnNumber: u32): void {
  // Log the error (if host provides logging) or just call the host's abort
  // console.log("Abort called in Wasm:"); // console.log might not be available depending on host
  // console.log("  Message: " + (message ? message : "N/A"));
  // console.log("  File: " + (fileName ? fileName : "N/A"));
  // console.log("  Location: " + lineNumber.toString() + ":" + columnNumber.toString());

  // Call the host-provided abort function
  hostAbort(message, fileName, lineNumber, columnNumber);
}