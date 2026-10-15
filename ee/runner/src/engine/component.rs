wasmtime::component::bindgen!({
    world: "runner",
    path: "wit",
    imports: { default: async },
    include_generated_code_from_file: true,
});
