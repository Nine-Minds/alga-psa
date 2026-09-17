// Preserve the actual Node runner protocol, including dynamic subtests and
// per-file completion. Console output is intentionally left to the spec
// reporter, rather than embedding arbitrary process output in the manifest.
export default async function* report(events) {
  for await (const event of events) {
    if (!['test:enqueue', 'test:dequeue', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) continue;
    yield JSON.stringify(event, (key, value) => value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack, code: value.code, failureType: value.failureType }
      : value) + '\n';
  }
}
