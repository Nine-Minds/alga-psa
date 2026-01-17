//! Extension runtime and management
//!
//! This module provides the Wasmtime-based extension runtime for
//! executing WASM security extensions with sandboxed capabilities.
//!
//! Features:
//! - F260: Wasmtime engine configuration with pooling allocation
//! - F261: Epoch interruption for execution time limits
//! - F280-F282: Extension bundle cache management

mod runtime;
mod loader;
mod capabilities;

pub use runtime::*;
pub use loader::*;
pub use capabilities::*;
