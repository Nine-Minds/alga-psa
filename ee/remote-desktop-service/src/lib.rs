//! Alga Remote Desktop Windows Service Library
//!
//! This crate provides the Windows service implementation for secure desktop
//! access, including UAC prompts and lock screen capture.

pub mod capture;
pub mod desktop;
pub mod ipc;
pub mod pipe_server;
pub mod service;

pub use ipc::*;
