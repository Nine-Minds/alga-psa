//! File Transfer Module for Remote Desktop Agent
//!
//! This module provides file transfer capabilities over WebRTC data channels:
//! - Upload files from the remote machine to the browser
//! - Download files from the browser to the remote machine
//! - Progress tracking and resumable transfers
//! - Path traversal protection and size limits
//!
//! ## Protocol
//!
//! File transfers use a dedicated WebRTC data channel with message-based protocol:
//! - Messages are JSON with binary payload for chunks
//! - Chunks are 16KB by default for optimal performance
//! - Each chunk includes sequence number for ordering and resume
//! - SHA-256 checksum for integrity verification

mod protocol;
mod transfer;

pub use protocol::*;
pub use transfer::*;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::{mpsc, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Default chunk size for file transfers (16 KB)
pub const DEFAULT_CHUNK_SIZE: usize = 16 * 1024;

/// Maximum file size for transfers (1 GB default)
pub const DEFAULT_MAX_FILE_SIZE: u64 = 1024 * 1024 * 1024;

/// File transfer manager
pub struct FileTransferManager {
    /// Active transfers (upload or download)
    transfers: Arc<RwLock<std::collections::HashMap<Uuid, ActiveTransfer>>>,
    /// Channel for sending messages to the data channel
    message_tx: mpsc::Sender<FileTransferMessage>,
    /// Allowed download directories (for security)
    allowed_paths: Vec<PathBuf>,
    /// Maximum file size
    max_file_size: u64,
    /// Chunk size
    chunk_size: usize,
}

/// An active file transfer
#[derive(Debug)]
pub struct ActiveTransfer {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Transfer type (upload or download)
    pub transfer_type: TransferType,
    /// File path on the local machine
    pub local_path: PathBuf,
    /// Original filename (for downloads)
    pub filename: String,
    /// Total file size
    pub total_size: u64,
    /// Bytes transferred so far
    pub transferred: u64,
    /// Current state
    pub state: TransferState,
    /// Chunk tracking (for resumable transfers)
    pub chunks: ChunkTracker,
    /// SHA-256 checksum (calculated incrementally)
    pub checksum: Option<String>,
    /// Started at timestamp
    pub started_at: std::time::Instant,
}

/// Transfer type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferType {
    /// Upload from agent to browser
    Upload,
    /// Download from browser to agent
    Download,
}

/// Transfer state
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferState {
    /// Transfer is pending/initializing
    Pending,
    /// Transfer is in progress
    InProgress,
    /// Transfer is paused (can be resumed)
    Paused,
    /// Transfer completed successfully
    Completed,
    /// Transfer failed
    Failed,
    /// Transfer was cancelled
    Cancelled,
}

/// Chunk tracking for resumable transfers
#[derive(Debug)]
pub struct ChunkTracker {
    /// Total number of chunks
    pub total_chunks: u32,
    /// Received/sent chunks (bitset)
    pub completed: Vec<bool>,
    /// Last received chunk index
    pub last_index: u32,
}

impl ChunkTracker {
    pub fn new(total_size: u64, chunk_size: usize) -> Self {
        let total_chunks = ((total_size + chunk_size as u64 - 1) / chunk_size as u64) as u32;
        Self {
            total_chunks,
            completed: vec![false; total_chunks as usize],
            last_index: 0,
        }
    }

    pub fn mark_completed(&mut self, index: u32) {
        if (index as usize) < self.completed.len() {
            self.completed[index as usize] = true;
            self.last_index = index;
        }
    }

    pub fn is_complete(&self) -> bool {
        self.completed.iter().all(|&c| c)
    }

    pub fn missing_chunks(&self) -> Vec<u32> {
        self.completed
            .iter()
            .enumerate()
            .filter(|(_, &c)| !c)
            .map(|(i, _)| i as u32)
            .collect()
    }

    pub fn completed_count(&self) -> u32 {
        self.completed.iter().filter(|&&c| c).count() as u32
    }
}

impl FileTransferManager {
    /// Create a new file transfer manager
    pub fn new(message_tx: mpsc::Sender<FileTransferMessage>) -> Self {
        Self {
            transfers: Arc::new(RwLock::new(std::collections::HashMap::new())),
            message_tx,
            allowed_paths: vec![
                // Default allowed paths - can be configured
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
                dirs::download_dir().unwrap_or_else(|| PathBuf::from("/tmp")),
            ],
            max_file_size: DEFAULT_MAX_FILE_SIZE,
            chunk_size: DEFAULT_CHUNK_SIZE,
        }
    }

    /// Configure maximum file size
    pub fn with_max_file_size(mut self, size: u64) -> Self {
        self.max_file_size = size;
        self
    }

    /// Configure allowed download paths
    pub fn with_allowed_paths(mut self, paths: Vec<PathBuf>) -> Self {
        self.allowed_paths = paths;
        self
    }

    /// Handle an incoming file transfer message
    pub async fn handle_message(&self, message: FileTransferMessage) -> Result<()> {
        match message {
            FileTransferMessage::Request(request) => {
                self.handle_request(request).await
            }
            FileTransferMessage::Chunk(chunk) => {
                self.handle_chunk(chunk).await
            }
            FileTransferMessage::Complete(complete) => {
                self.handle_complete(complete).await
            }
            FileTransferMessage::Error(error) => {
                self.handle_error(error).await
            }
            FileTransferMessage::Cancel(cancel) => {
                self.handle_cancel(cancel).await
            }
            FileTransferMessage::Resume(resume) => {
                self.handle_resume(resume).await
            }
            _ => {
                warn!("Unhandled file transfer message type");
                Ok(())
            }
        }
    }

    /// Handle a file transfer request
    async fn handle_request(&self, request: FileRequest) -> Result<()> {
        match request.direction {
            TransferDirection::Download => {
                // Browser wants to download a file from the agent
                self.start_upload(&request).await
            }
            TransferDirection::Upload => {
                // Browser wants to upload a file to the agent
                self.prepare_download(&request).await
            }
        }
    }

    /// Start uploading a file to the browser
    async fn start_upload(&self, request: &FileRequest) -> Result<()> {
        let path = PathBuf::from(&request.path);

        // Security: Validate path
        if !self.is_path_allowed(&path) {
            self.send_error(
                request.transfer_id,
                FileTransferErrorCode::AccessDenied,
                "Path not allowed",
            ).await?;
            return Ok(());
        }

        // Check file exists and get metadata
        let metadata = match tokio::fs::metadata(&path).await {
            Ok(m) => m,
            Err(e) => {
                self.send_error(
                    request.transfer_id,
                    FileTransferErrorCode::NotFound,
                    &format!("File not found: {}", e),
                ).await?;
                return Ok(());
            }
        };

        if !metadata.is_file() {
            self.send_error(
                request.transfer_id,
                FileTransferErrorCode::NotAFile,
                "Path is not a file",
            ).await?;
            return Ok(());
        }

        let file_size = metadata.len();

        // Check size limit
        if file_size > self.max_file_size {
            self.send_error(
                request.transfer_id,
                FileTransferErrorCode::FileTooLarge,
                &format!("File exceeds maximum size of {} bytes", self.max_file_size),
            ).await?;
            return Ok(());
        }

        let filename = path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        // Create transfer record
        let transfer = ActiveTransfer {
            transfer_id: request.transfer_id,
            transfer_type: TransferType::Upload,
            local_path: path.clone(),
            filename: filename.clone(),
            total_size: file_size,
            transferred: 0,
            state: TransferState::InProgress,
            chunks: ChunkTracker::new(file_size, self.chunk_size),
            checksum: None,
            started_at: std::time::Instant::now(),
        };

        {
            let mut transfers = self.transfers.write().await;
            transfers.insert(request.transfer_id, transfer);
        }

        // Send response with file info
        self.message_tx.send(FileTransferMessage::Response(FileResponse {
            transfer_id: request.transfer_id,
            accepted: true,
            file_size,
            filename,
            chunk_size: self.chunk_size as u32,
            error: None,
        })).await?;

        // Start sending chunks
        self.send_file_chunks(request.transfer_id, &path, file_size).await?;

        Ok(())
    }

    /// Prepare to receive a file from the browser
    async fn prepare_download(&self, request: &FileRequest) -> Result<()> {
        let download_dir = dirs::download_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let path = download_dir.join(&request.filename.as_deref().unwrap_or("download"));

        // Security: Ensure we're writing to allowed location
        if !self.is_path_allowed(&path) {
            self.send_error(
                request.transfer_id,
                FileTransferErrorCode::AccessDenied,
                "Download path not allowed",
            ).await?;
            return Ok(());
        }

        let file_size = request.file_size.unwrap_or(0);

        // Check size limit
        if file_size > self.max_file_size {
            self.send_error(
                request.transfer_id,
                FileTransferErrorCode::FileTooLarge,
                &format!("File exceeds maximum size of {} bytes", self.max_file_size),
            ).await?;
            return Ok(());
        }

        let filename = request.filename.clone().unwrap_or_else(|| "download".to_string());

        // Create transfer record
        let transfer = ActiveTransfer {
            transfer_id: request.transfer_id,
            transfer_type: TransferType::Download,
            local_path: path.clone(),
            filename: filename.clone(),
            total_size: file_size,
            transferred: 0,
            state: TransferState::InProgress,
            chunks: ChunkTracker::new(file_size, self.chunk_size),
            checksum: None,
            started_at: std::time::Instant::now(),
        };

        {
            let mut transfers = self.transfers.write().await;
            transfers.insert(request.transfer_id, transfer);
        }

        // Create temp file for download
        let temp_path = path.with_extension("download");
        tokio::fs::File::create(&temp_path).await?;

        // Send acceptance
        self.message_tx.send(FileTransferMessage::Response(FileResponse {
            transfer_id: request.transfer_id,
            accepted: true,
            file_size,
            filename,
            chunk_size: self.chunk_size as u32,
            error: None,
        })).await?;

        Ok(())
    }

    /// Handle an incoming chunk
    async fn handle_chunk(&self, chunk: FileChunk) -> Result<()> {
        let mut transfers = self.transfers.write().await;

        let transfer = match transfers.get_mut(&chunk.transfer_id) {
            Some(t) => t,
            None => {
                warn!("Received chunk for unknown transfer: {}", chunk.transfer_id);
                return Ok(());
            }
        };

        if transfer.state != TransferState::InProgress {
            return Ok(());
        }

        // Write chunk to file
        let temp_path = transfer.local_path.with_extension("download");

        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&temp_path)
            .await?;

        let offset = chunk.sequence as u64 * self.chunk_size as u64;
        file.seek(std::io::SeekFrom::Start(offset)).await?;
        file.write_all(&chunk.data).await?;
        file.flush().await?;

        // Update tracking
        transfer.chunks.mark_completed(chunk.sequence);
        transfer.transferred += chunk.data.len() as u64;

        debug!(
            "Received chunk {}/{} for transfer {}",
            chunk.sequence + 1,
            transfer.chunks.total_chunks,
            chunk.transfer_id
        );

        // Send acknowledgment
        self.message_tx.send(FileTransferMessage::Ack(FileAck {
            transfer_id: chunk.transfer_id,
            sequence: chunk.sequence,
        })).await?;

        Ok(())
    }

    /// Handle transfer completion
    async fn handle_complete(&self, complete: FileComplete) -> Result<()> {
        let mut transfers = self.transfers.write().await;

        let transfer = match transfers.get_mut(&complete.transfer_id) {
            Some(t) => t,
            None => {
                warn!("Received complete for unknown transfer: {}", complete.transfer_id);
                return Ok(());
            }
        };

        if transfer.transfer_type == TransferType::Download {
            // Verify checksum if provided
            if let Some(expected_checksum) = &complete.checksum {
                let actual_checksum = self.calculate_checksum(&transfer.local_path.with_extension("download")).await?;
                if &actual_checksum != expected_checksum {
                    transfer.state = TransferState::Failed;
                    self.send_error(
                        complete.transfer_id,
                        FileTransferErrorCode::ChecksumMismatch,
                        "Checksum verification failed",
                    ).await?;
                    return Ok(());
                }
            }

            // Move temp file to final location
            let temp_path = transfer.local_path.with_extension("download");
            tokio::fs::rename(&temp_path, &transfer.local_path).await?;
        }

        transfer.state = TransferState::Completed;
        let duration = transfer.started_at.elapsed();

        info!(
            "Transfer {} completed: {} bytes in {:.2}s ({:.2} MB/s)",
            complete.transfer_id,
            transfer.total_size,
            duration.as_secs_f64(),
            transfer.total_size as f64 / duration.as_secs_f64() / 1024.0 / 1024.0
        );

        Ok(())
    }

    /// Handle transfer error
    async fn handle_error(&self, error: FileTransferError) -> Result<()> {
        let mut transfers = self.transfers.write().await;

        if let Some(transfer) = transfers.get_mut(&error.transfer_id) {
            transfer.state = TransferState::Failed;
            error!(
                "Transfer {} failed: {} (code: {:?})",
                error.transfer_id, error.message, error.code
            );

            // Clean up temp file if download
            if transfer.transfer_type == TransferType::Download {
                let temp_path = transfer.local_path.with_extension("download");
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
        }

        Ok(())
    }

    /// Handle transfer cancellation
    async fn handle_cancel(&self, cancel: FileCancel) -> Result<()> {
        let mut transfers = self.transfers.write().await;

        if let Some(transfer) = transfers.get_mut(&cancel.transfer_id) {
            transfer.state = TransferState::Cancelled;
            info!("Transfer {} cancelled", cancel.transfer_id);

            // Clean up temp file if download
            if transfer.transfer_type == TransferType::Download {
                let temp_path = transfer.local_path.with_extension("download");
                let _ = tokio::fs::remove_file(&temp_path).await;
            }
        }

        Ok(())
    }

    /// Handle resume request
    async fn handle_resume(&self, resume: FileResume) -> Result<()> {
        let transfers = self.transfers.read().await;

        let transfer = match transfers.get(&resume.transfer_id) {
            Some(t) => t,
            None => {
                warn!("Resume request for unknown transfer: {}", resume.transfer_id);
                return Ok(());
            }
        };

        if transfer.transfer_type == TransferType::Upload {
            // Resend missing chunks
            let missing = transfer.chunks.missing_chunks();
            drop(transfers);

            for seq in missing {
                if let Err(e) = self.send_chunk(resume.transfer_id, seq).await {
                    error!("Failed to resend chunk {}: {}", seq, e);
                }
            }
        }

        Ok(())
    }

    /// Send file chunks
    async fn send_file_chunks(&self, transfer_id: Uuid, path: &Path, size: u64) -> Result<()> {
        use tokio::io::AsyncReadExt;

        let mut file = tokio::fs::File::open(path).await?;
        let mut buffer = vec![0u8; self.chunk_size];
        let mut sequence: u32 = 0;

        loop {
            let bytes_read = file.read(&mut buffer).await?;
            if bytes_read == 0 {
                break;
            }

            self.message_tx.send(FileTransferMessage::Chunk(FileChunk {
                transfer_id,
                sequence,
                data: buffer[..bytes_read].to_vec(),
                is_last: bytes_read < self.chunk_size,
            })).await?;

            {
                let mut transfers = self.transfers.write().await;
                if let Some(transfer) = transfers.get_mut(&transfer_id) {
                    transfer.chunks.mark_completed(sequence);
                    transfer.transferred += bytes_read as u64;
                }
            }

            sequence += 1;

            // Small delay to avoid overwhelming the data channel
            tokio::time::sleep(std::time::Duration::from_micros(100)).await;
        }

        // Calculate checksum
        let checksum = self.calculate_checksum(path).await?;

        // Send completion message
        self.message_tx.send(FileTransferMessage::Complete(FileComplete {
            transfer_id,
            checksum: Some(checksum),
        })).await?;

        {
            let mut transfers = self.transfers.write().await;
            if let Some(transfer) = transfers.get_mut(&transfer_id) {
                transfer.state = TransferState::Completed;
            }
        }

        Ok(())
    }

    /// Send a specific chunk (for resume)
    async fn send_chunk(&self, transfer_id: Uuid, sequence: u32) -> Result<()> {
        let transfers = self.transfers.read().await;
        let transfer = transfers.get(&transfer_id).context("Transfer not found")?;
        let path = transfer.local_path.clone();
        drop(transfers);

        use tokio::io::{AsyncReadExt, AsyncSeekExt};

        let mut file = tokio::fs::File::open(&path).await?;
        let offset = sequence as u64 * self.chunk_size as u64;
        file.seek(std::io::SeekFrom::Start(offset)).await?;

        let mut buffer = vec![0u8; self.chunk_size];
        let bytes_read = file.read(&mut buffer).await?;

        self.message_tx.send(FileTransferMessage::Chunk(FileChunk {
            transfer_id,
            sequence,
            data: buffer[..bytes_read].to_vec(),
            is_last: bytes_read < self.chunk_size,
        })).await?;

        Ok(())
    }

    /// Calculate SHA-256 checksum of a file
    async fn calculate_checksum(&self, path: &Path) -> Result<String> {
        use sha2::{Sha256, Digest};
        use tokio::io::AsyncReadExt;

        let mut file = tokio::fs::File::open(path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 64 * 1024];

        loop {
            let bytes_read = file.read(&mut buffer).await?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Send an error message
    async fn send_error(
        &self,
        transfer_id: Uuid,
        code: FileTransferErrorCode,
        message: &str,
    ) -> Result<()> {
        self.message_tx.send(FileTransferMessage::Error(FileTransferError {
            transfer_id,
            code,
            message: message.to_string(),
        })).await?;
        Ok(())
    }

    /// Check if a path is allowed for transfer
    fn is_path_allowed(&self, path: &Path) -> bool {
        // Normalize the path
        let canonical = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                // If path doesn't exist yet (for downloads), check parent
                if let Some(parent) = path.parent() {
                    match parent.canonicalize() {
                        Ok(p) => p,
                        Err(_) => return false,
                    }
                } else {
                    return false;
                }
            }
        };

        // Check against allowed paths
        self.allowed_paths.iter().any(|allowed| {
            match allowed.canonicalize() {
                Ok(allowed_canonical) => canonical.starts_with(&allowed_canonical),
                Err(_) => false,
            }
        })
    }

    /// Get transfer status
    pub async fn get_transfer(&self, transfer_id: Uuid) -> Option<TransferStatus> {
        let transfers = self.transfers.read().await;
        transfers.get(&transfer_id).map(|t| TransferStatus {
            transfer_id: t.transfer_id,
            filename: t.filename.clone(),
            total_size: t.total_size,
            transferred: t.transferred,
            state: t.state,
            progress: t.transferred as f64 / t.total_size as f64 * 100.0,
        })
    }

    /// List all active transfers
    pub async fn list_transfers(&self) -> Vec<TransferStatus> {
        let transfers = self.transfers.read().await;
        transfers.values().map(|t| TransferStatus {
            transfer_id: t.transfer_id,
            filename: t.filename.clone(),
            total_size: t.total_size,
            transferred: t.transferred,
            state: t.state,
            progress: t.transferred as f64 / t.total_size as f64 * 100.0,
        }).collect()
    }

    /// Cancel a transfer
    pub async fn cancel_transfer(&self, transfer_id: Uuid) -> Result<()> {
        {
            let mut transfers = self.transfers.write().await;
            if let Some(transfer) = transfers.get_mut(&transfer_id) {
                transfer.state = TransferState::Cancelled;
            }
        }

        self.message_tx.send(FileTransferMessage::Cancel(FileCancel {
            transfer_id,
            reason: Some("Cancelled by user".to_string()),
        })).await?;

        Ok(())
    }
}

/// Transfer status for external queries
#[derive(Debug, Clone)]
pub struct TransferStatus {
    pub transfer_id: Uuid,
    pub filename: String,
    pub total_size: u64,
    pub transferred: u64,
    pub state: TransferState,
    pub progress: f64,
}

use tokio::io::AsyncSeekExt;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_tracker() {
        let mut tracker = ChunkTracker::new(100_000, 16_384);
        assert_eq!(tracker.total_chunks, 7);
        assert!(!tracker.is_complete());

        for i in 0..7 {
            tracker.mark_completed(i);
        }
        assert!(tracker.is_complete());
    }
}
