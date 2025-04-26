// Custom abort function to provide more context in case of errors
// See: https://www.assemblyscript.org/concepts/runtime.html#custom-abort-function
export function abort(message: string | null, fileName: string | null, lineNumber: u32, columnNumber: u32): void {
  // Log the error details. In a real Wasm host, this might call a host function.
  const msg = message ? message : "Unknown error";
  const file = fileName ? fileName : "unknown file";
  const line = lineNumber.toString();
  const col = columnNumber.toString();
  
  // Example logging (replace with host function call if available)
  console.error(`AssemblyScript Error: ${msg} at ${file}:${line}:${col}`);

  // Trigger the Wasm trap
  unreachable(); 
}