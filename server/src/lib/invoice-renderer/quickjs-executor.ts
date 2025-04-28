import {
  getQuickJS,
  QuickJSContext,
  QuickJSHandle,
  QuickJSEmscriptenModule,
  QuickJSWASMModule
} from 'quickjs-emscripten';
import type { InvoiceViewModel, LayoutElement } from './types';

/**
 * Executes the TypeScript/JavaScript template module using QuickJS-Emscripten.
 *
 * @param templateJs - The string containing the compiled JavaScript template code.
 * @param invoiceData - The input data for the invoice template.
 * @param quickjsModule - Optional: Pass the QuickJS module if already loaded to avoid reloading.
 * @returns A promise that resolves to the deserialized Layout Data Structure.
 * @throws If QuickJS initialization, VM creation, or execution fails.
 */
export async function executeJsTemplate(
  templateJs: string,
  invoiceData: InvoiceViewModel,
  quickjsModule?: QuickJSWASMModule // Optional: Pass if already loaded
): Promise<LayoutElement> {
  // getQuickJS returns QuickJSWASMModule
  const quickjs: QuickJSWASMModule = quickjsModule || await getQuickJS();
  const runtime = quickjs.newRuntime(); // Create a runtime first
  const vm: QuickJSContext = runtime.newContext(); // Then create a context from the runtime

  // Keep track of handles that need disposal
  const handles: QuickJSHandle[] = [];

  try {
    // --- Expose Host Functions ---

    // console.log
    const logHandle = vm.newFunction("log", (...args: QuickJSHandle[]) => {
      const nativeArgs = args.map(arg => vm.dump(arg));
      console.log("[QuickJS Log]:", ...nativeArgs);
      // Handles passed to console.log are owned by the caller (QuickJS internals or the template code)
      // We don't dispose them here.
    });
    handles.push(logHandle); // Track handle

    const consoleObjHandle = vm.newObject();
    vm.setProp(consoleObjHandle, "log", logHandle);
    vm.setProp(vm.global, "console", consoleObjHandle);
    handles.push(consoleObjHandle); // Track handle

    // Simplified error function for templates to report issues
    const errorHandle = vm.newFunction("error", (messageHandle?: QuickJSHandle) => {
        const message = messageHandle ? vm.dump(messageHandle) : "No message provided";
        console.error(`[QuickJS Error]: Template reported error: "${message}"`);
        // Dispose the message handle if it was passed
        if (messageHandle && messageHandle.alive) {
            messageHandle.dispose();
        }
        // Decide if template errors should halt execution immediately
        // For now, just log. Could throw new Error(...) here if needed.
    });
    vm.setProp(vm.global, "error", errorHandle); // Expose as global 'error' function
    handles.push(errorHandle); // Track handle


    // --- Prepare Input Data ---
    // Use JSON stringify on host + evalCode in VM for robust object passing
    const inputJson = JSON.stringify(invoiceData);
    const inputEvalResult = vm.evalCode(`(${inputJson})`); // Parse JSON inside VM

    if (inputEvalResult.error) {
        const error = vm.dump(inputEvalResult.error);
        inputEvalResult.error.dispose(); // Dispose error handle
        throw new Error(`Failed to parse input JSON in QuickJS: ${error?.message || error}`);
    }
    const inputHandle = inputEvalResult.value;
    handles.push(inputHandle); // Track input object handle


    // --- Load Template Code ---
    // Evaluate the template code string. This defines functions like generateLayout in the VM's global scope.
    const evalResult = vm.evalCode(templateJs);

    if (evalResult.error) {
        const error = vm.dump(evalResult.error);
        evalResult.error.dispose(); // Dispose error handle
        throw new Error(`Error evaluating template JS in QuickJS: ${error?.message || error}`);
    }
    // Dispose the handle for the result of evalCode (often undefined)
    if (evalResult.value && evalResult.value.alive) {
        evalResult.value.dispose();
    }


    // --- Get Handle to generateLayout Function ---
    const generateLayoutFnHandle = vm.getProp(vm.global, "generateLayout");
    handles.push(generateLayoutFnHandle); // Track function handle

    // Verify it's a function before attempting to call
    if (vm.typeof(generateLayoutFnHandle) !== 'function') {
        throw new Error(`Template must export a function named 'generateLayout'.`);
    }


    // --- Execute generateLayout ---
    const callResult = vm.callFunction(generateLayoutFnHandle, vm.global, inputHandle);

    // Check for errors thrown during the function call itself
    if (callResult.error) {
        const error = vm.dump(callResult.error);
        callResult.error.dispose(); // Dispose error handle
        throw new Error(`Error executing generateLayout in QuickJS: ${error?.message || error}`);
    }


    // --- Process Result ---
    const outputHandle = callResult.value;
    handles.push(outputHandle); // Track result handle

    // Dump the QuickJS value back into a standard JavaScript object/value
    const outputLayout = vm.dump(outputHandle) as LayoutElement;

    // Basic validation of the returned structure
    if (!outputLayout || typeof outputLayout !== 'object' || !outputLayout.type) {
        console.warn('QuickJS generateLayout function returned invalid or empty result.', outputLayout);
        // Return a default empty document structure for safety
         return { type: 'Document', children: [] } as LayoutElement;
    }

    // Return the valid layout structure
    return outputLayout;

  } catch (error) {
    // Log any caught errors before re-throwing
    console.error('Error during QuickJS template execution:', error);
    // Ensure the error is an Error instance before throwing
    if (error instanceof Error) {
        throw error; // Re-throw the original error
    } else {
        throw new Error(`QuickJS execution failed with non-error value: ${error}`);
    }
  } finally {
    // --- Cleanup ---
    // Dispose all tracked handles in reverse order (helps with dependencies)
    handles.reverse().forEach(handle => {
        // Check if handle exists and is still alive before disposing
        if (handle && handle.alive) {
            handle.dispose();
        }
    });
    // IMPORTANT: Dispose the VM context and the runtime
    if (vm && vm.alive) {
        vm.dispose();
    }
    if (runtime && runtime.alive) {
        runtime.dispose(); // Dispose the runtime as well
    }
  }
}