/* eslint-disable no-console */

function createLogger({ debug }) {
  return {
    info: (...args) => console.error(...args),
    warn: (...args) => console.error(...args),
    error: (...args) => console.error(...args),
    debug: (...args) => {
      if (debug) console.error(...args);
    }
  };
}

function createTestContext(config, deps = {}) {
  const logger = deps.logger ?? createLogger({ debug: !!config.debug });
  const cleanupFns = [];

  const ctx = {
    config: {
      baseUrl: config.baseUrl,
      tenantId: config.tenantId,
      timeoutMs: config.timeoutMs,
      debug: !!config.debug,
      artifactsDir: config.artifactsDir
    },

    log: logger,

    onCleanup(fn) {
      if (typeof fn !== 'function') throw new Error('ctx.onCleanup requires a function');
      cleanupFns.push(fn);
    },

    async runCleanup() {
      const errors = [];
      for (let i = cleanupFns.length - 1; i >= 0; i -= 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await cleanupFns[i]();
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length) {
        const message = errors.map((e) => (e && e.message) || String(e)).join('\n');
        const error = new Error(`Cleanup failed:\n${message}`);
        error.causes = errors;
        throw error;
      }
    }
  };

  return ctx;
}

module.exports = {
  createTestContext
};

