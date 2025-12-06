//! Remote Desktop Agent Library
//!
//! This library provides the core functionality for the Remote Desktop Agent.
//! It can be used as a Rust library or via FFI from Swift (macOS) or other languages.

pub mod config;
pub mod capture;
pub mod input;
pub mod signaling;
pub mod file_transfer;

#[cfg(target_os = "macos")]
pub mod ffi;

#[cfg(target_os = "windows")]
pub mod service_client;

// Re-export commonly used types
pub use config::Config;
pub use capture::{ScreenCapturer, FrameProducer, CapturedFrame};
pub use input::{InputController, InputEvent};
pub use signaling::{SignalingClient, SignalingEvent};
pub use file_transfer::{FileTransferManager, FileTransferMessage, TransferStatus};

#[cfg(target_os = "windows")]
pub use service_client::ServiceClient;
