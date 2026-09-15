// Test-only transport interception. Never imported by application source.
const target = new URL(process.env.NATIVE_MICROSOFT_OIDC_AUTHORITY || 'http://invalid.invalid');
if (process.env.NODE_ENV === 'production' || process.env.NATIVE_MICROSOFT_OIDC_ISOLATED !== 'true' || target.hostname !== '127.0.0.1'
  || target.search || target.hash || target.protocol !== 'http:' || target.pathname !== '/' || target.username || target.password) {
  throw new Error('Microsoft callback harness requires an isolated loopback authority');
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === 'https://login.microsoftonline.com') {
    const redirected = new URL(url.pathname + url.search, target);
    return originalFetch(input instanceof Request ? new Request(redirected, input) : redirected, init);
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('External network destination refused by isolated callback harness');
  }
  return originalFetch(input, init);
};
