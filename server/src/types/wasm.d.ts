// Tell TypeScript that importing a .wasm file yields a string (the path/URL)
declare module '*.wasm' {
  const path: string;
  export default path;
}