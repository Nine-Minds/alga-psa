//! File Transfer Protocol Messages
//!
//! Defines the message format for file transfers over WebRTC data channels.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// File transfer message envelope
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileTransferMessage {
    /// Request to start a file transfer
    Request(FileRequest),
    /// Response to a transfer request
    Response(FileResponse),
    /// File data chunk
    Chunk(FileChunk),
    /// Chunk acknowledgment
    Ack(FileAck),
    /// Transfer complete notification
    Complete(FileComplete),
    /// Transfer error
    Error(FileTransferError),
    /// Cancel transfer
    Cancel(FileCancel),
    /// Resume transfer
    Resume(FileResume),
    /// Progress update
    Progress(FileProgress),
    /// List files request
    ListFiles(ListFilesRequest),
    /// List files response
    FileList(FileListResponse),
}

/// Direction of file transfer
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    /// Upload from browser to agent
    Upload,
    /// Download from agent to browser
    Download,
}

/// Request to initiate a file transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRequest {
    /// Unique transfer ID
    pub transfer_id: Uuid,
    /// Transfer direction
    pub direction: TransferDirection,
    /// File path on the agent (for downloads) or destination path (for uploads)
    pub path: String,
    /// Filename (required for uploads)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    /// File size (required for uploads)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    /// MIME type hint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Response to a file transfer request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileResponse {
    /// Transfer ID from the request
    pub transfer_id: Uuid,
    /// Whether the transfer was accepted
    pub accepted: bool,
    /// File size (for download direction)
    pub file_size: u64,
    /// Filename
    pub filename: String,
    /// Chunk size to use
    pub chunk_size: u32,
    /// Error message if not accepted
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A chunk of file data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChunk {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Sequence number (0-indexed)
    pub sequence: u32,
    /// Chunk data
    #[serde(with = "base64_serde")]
    pub data: Vec<u8>,
    /// Whether this is the last chunk
    pub is_last: bool,
}

/// Acknowledgment for a received chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAck {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Sequence number that was received
    pub sequence: u32,
}

/// Transfer completion notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileComplete {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// SHA-256 checksum of the complete file
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
}

/// File transfer error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTransferError {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Error code
    pub code: FileTransferErrorCode,
    /// Human-readable error message
    pub message: String,
}

/// Error codes for file transfers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferErrorCode {
    /// File not found
    NotFound,
    /// Access denied
    AccessDenied,
    /// File is too large
    FileTooLarge,
    /// Path is not a file
    NotAFile,
    /// Invalid path (path traversal attempt, etc.)
    InvalidPath,
    /// Disk full
    DiskFull,
    /// IO error
    IoError,
    /// Transfer already exists
    TransferExists,
    /// Transfer not found
    TransferNotFound,
    /// Checksum mismatch
    ChecksumMismatch,
    /// Transfer was cancelled
    Cancelled,
    /// Internal error
    Internal,
}

/// Cancel a transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileCancel {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Reason for cancellation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Resume a transfer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileResume {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Last received sequence number
    pub last_sequence: u32,
}

/// Progress update
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileProgress {
    /// Transfer ID
    pub transfer_id: Uuid,
    /// Bytes transferred
    pub transferred: u64,
    /// Total bytes
    pub total: u64,
    /// Transfer speed in bytes per second
    pub speed_bps: u64,
    /// Estimated time remaining in seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_seconds: Option<u32>,
}

/// Request to list files in a directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListFilesRequest {
    /// Directory path to list
    pub path: String,
    /// Whether to include hidden files
    #[serde(default)]
    pub include_hidden: bool,
}

/// Response with file listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileListResponse {
    /// Directory path that was listed
    pub path: String,
    /// Files and directories in the path
    pub entries: Vec<FileEntry>,
    /// Error if listing failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A file or directory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Entry name
    pub name: String,
    /// Full path
    pub path: String,
    /// Whether this is a directory
    pub is_directory: bool,
    /// File size (0 for directories)
    pub size: u64,
    /// Last modified timestamp (Unix epoch seconds)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<u64>,
    /// MIME type hint
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Whether the file is hidden
    pub hidden: bool,
    /// Whether the file is readable
    pub readable: bool,
    /// Whether the file is writable
    pub writable: bool,
}

/// Base64 serialization for binary data
mod base64_serde {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        STANDARD.decode(&s).map_err(serde::de::Error::custom)
    }
}

impl FileTransferMessage {
    /// Get the transfer ID if applicable
    pub fn transfer_id(&self) -> Option<Uuid> {
        match self {
            FileTransferMessage::Request(r) => Some(r.transfer_id),
            FileTransferMessage::Response(r) => Some(r.transfer_id),
            FileTransferMessage::Chunk(c) => Some(c.transfer_id),
            FileTransferMessage::Ack(a) => Some(a.transfer_id),
            FileTransferMessage::Complete(c) => Some(c.transfer_id),
            FileTransferMessage::Error(e) => Some(e.transfer_id),
            FileTransferMessage::Cancel(c) => Some(c.transfer_id),
            FileTransferMessage::Resume(r) => Some(r.transfer_id),
            FileTransferMessage::Progress(p) => Some(p.transfer_id),
            FileTransferMessage::ListFiles(_) => None,
            FileTransferMessage::FileList(_) => None,
        }
    }

    /// Serialize to JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from JSON
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_request() {
        let request = FileTransferMessage::Request(FileRequest {
            transfer_id: Uuid::new_v4(),
            direction: TransferDirection::Download,
            path: "/home/user/file.txt".to_string(),
            filename: None,
            file_size: None,
            mime_type: None,
        });

        let json = request.to_json().unwrap();
        assert!(json.contains("request"));
        assert!(json.contains("download"));
    }

    #[test]
    fn test_serialize_chunk() {
        let chunk = FileTransferMessage::Chunk(FileChunk {
            transfer_id: Uuid::new_v4(),
            sequence: 0,
            data: vec![1, 2, 3, 4, 5],
            is_last: false,
        });

        let json = chunk.to_json().unwrap();
        let parsed = FileTransferMessage::from_json(&json).unwrap();

        if let FileTransferMessage::Chunk(c) = parsed {
            assert_eq!(c.data, vec![1, 2, 3, 4, 5]);
        } else {
            panic!("Expected chunk message");
        }
    }
}
