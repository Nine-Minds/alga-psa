class HarnessAssertionError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'HarnessAssertionError';
    this.details = details;
  }
}

class HarnessTimeoutError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'HarnessTimeoutError';
    this.details = details;
  }
}

function ok(condition, message = 'Expected condition to be truthy', details) {
  if (condition) return;
  throw new HarnessAssertionError(message, details);
}

function equal(actual, expected, message = 'Expected values to be equal', details) {
  if (actual === expected) return;
  throw new HarnessAssertionError(
    `${message}. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    { ...details, expected, actual }
  );
}

function match(actual, regex, message = 'Expected value to match pattern', details) {
  const text = String(actual ?? '');
  if (regex.test(text)) return;
  throw new HarnessAssertionError(`${message}. pattern=${String(regex)} actual=${JSON.stringify(text)}`, {
    ...details,
    pattern: String(regex),
    actual: text
  });
}

function withTimeout(promise, timeoutMs, message = 'Timed out') {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new HarnessTimeoutError(message, { timeoutMs })), timeoutMs);
  });
  return Promise.race([promise.finally(() => clearTimeout(timeoutId)), timeout]);
}

module.exports = {
  HarnessAssertionError,
  HarnessTimeoutError,
  ok,
  equal,
  match,
  withTimeout
};

