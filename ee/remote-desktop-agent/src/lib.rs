//! Remote Desktop Agent Library
//!
//! This library provides the core functionality for the Remote Desktop Agent.
//! It can be used as a Rust library or via FFI from Swift (macOS) or other languages.

pub mod config;
pub mod capture;
pub mod input;
pub mod signaling;

#[cfg(target_os = "macos")]
pub mod ffi;

// Re-export commonly used types
pub use config::Config;
pub use capture::{ScreenCapturer, FrameProducer, CapturedFrame};
pub use input::{InputController, InputEvent};
pub use signaling::{SignalingClient, SignalingEvent};
