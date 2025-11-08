wasmtime::component::bindgen!({
    world: "runner",
    path: "wit",
    imports: { default: async | store },
    include_generated_code_from_file: true,
});
