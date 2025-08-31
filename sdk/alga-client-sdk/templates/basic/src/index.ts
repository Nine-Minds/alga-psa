export function hello() {
  return 'Hello from __PACKAGE_NAME__!';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(hello());
}

