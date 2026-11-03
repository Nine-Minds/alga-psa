type NativeSubscription<T> = AsyncIterator<T> & AsyncIterable<T>;

interface TurbopackProject {
  clientHmrEvents(chunkName: string): NativeSubscription<unknown>;
}

interface ProjectResult {
  value: TurbopackProject;
  issues?: unknown;
}

export interface TurbopackBindings {
  getTargetTriple(): string | undefined;
  turbo: {
    createProject: (...args: unknown[]) => Promise<ProjectResult>;
  };
}

export type DiagnosticWriter = (line: string) => void;

const instrumentedBindings = new WeakSet<object>();

function diagnosticValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return String(value);
    if (serialized.length <= 12_000) return JSON.parse(serialized);
    return {
      truncated: true,
      preview: serialized.slice(0, 12_000),
      originalLength: serialized.length,
    };
  } catch (error) {
    return {
      unserializable: String(error),
      preview: String(value).slice(0, 2_000),
    };
  }
}

function instrumentSubscription<T>(
  subscription: NativeSubscription<T>,
  context: Record<string, unknown>,
  write: DiagnosticWriter,
): NativeSubscription<T> {
  let sequence = 0;
  let initial = true;
  const record = (event: Record<string, unknown>) => {
    write(
      JSON.stringify({
        source: 'next-turbopack-client-hmr-subscription',
        at: new Date().toISOString(),
        ...context,
        ...event,
      }),
    );
  };

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next(): Promise<IteratorResult<T>> {
      let result: IteratorResult<T>;
      try {
        result = await subscription.next();
      } catch (error) {
        record({ phase: 'rejected', sequence: sequence++, error: String(error) });
        throw error;
      }
      record({
        phase: result.done ? 'complete' : initial ? 'initial' : 'stream',
        sequence: sequence++,
        done: result.done ?? false,
        value: result.done ? undefined : diagnosticValue(result.value),
      });
      initial = false;
      return result;
    },
    async return(): Promise<IteratorResult<T>> {
      record({ phase: 'closed', sequence });
      if (subscription.return) return subscription.return();
      return { done: true, value: undefined };
    },
    async throw(error?: unknown): Promise<IteratorResult<T>> {
      record({ phase: 'thrown', sequence, error: String(error) });
      if (subscription.throw) return subscription.throw(error);
      throw error;
    },
  };
}

/**
 * Instrument the native Turbopack subscription at its boundary with Next's
 * JavaScript HMR handler. The wrapper returns every item unchanged, including
 * the initial baseline event Next forwards to clients.
 */
export async function installTurbopackHmrSubscriptionDiagnostics(
  loadBindings: () => Promise<TurbopackBindings>,
  write: DiagnosticWriter = (line) => process.stderr.write(`${line}\n`),
): Promise<void> {
  const bindings = await loadBindings();
  if (instrumentedBindings.has(bindings)) return;
  instrumentedBindings.add(bindings);
  const createProject = bindings.turbo.createProject;
  let subscriptionId = 0;
  let writerFailed = false;
  const report: DiagnosticWriter = (line) => {
    if (writerFailed) return;
    try {
      write(line);
    } catch (error) {
      // A broken diagnostic sink must not create the HMR failure it observes
      // or prevent Next from closing the native subscription.
      writerFailed = true;
      console.warn('Turbopack subscription diagnostics disabled: writer failed', error);
    }
  };

  bindings.turbo.createProject = async function (...args) {
    const result = await createProject.apply(this, args);
    const project = result.value;
    const clientHmrEvents = project.clientHmrEvents.bind(project);
    const options = (args[0] ?? {}) as Record<string, unknown>;
    const context = {
      rootPath: options.rootPath,
      projectPath: options.projectPath,
      distDir: options.distDir,
    };

    project.clientHmrEvents = (chunkName) => {
      const subscription = clientHmrEvents(chunkName);
      return instrumentSubscription(
        subscription,
        { ...context, chunkName, subscriptionId: subscriptionId++ },
        report,
      );
    };
    return result;
  };

  report(
    JSON.stringify({
      source: 'next-turbopack-client-hmr-subscription',
      at: new Date().toISOString(),
      phase: 'installed',
      targetTriple: bindings.getTargetTriple(),
    }),
  );
}
