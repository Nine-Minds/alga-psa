// Placeholder for host API imports exposed to WASM (alga.*)

pub struct HostApiConfig {
    pub egress_allowlist: Vec<String>,
}

impl Default for HostApiConfig {
    fn default() -> Self {
        Self { egress_allowlist: vec![] }
    }
}

