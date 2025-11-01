use std::error::Error;
use std::fmt;

/// Integrity-related errors for bundle fetching/verification.
#[derive(Debug, Clone)]
pub enum IntegrityError {
    /// The downloaded archive's SHA-256 does not match the URL-indicated hash.
    ArchiveHashMismatch {
        expected_hex: String,
        computed_hex: String,
    },
}

impl fmt::Display for IntegrityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IntegrityError::ArchiveHashMismatch {
                expected_hex,
                computed_hex,
            } => {
                write!(
                    f,
                    "archive hash mismatch: expected {}, got {}",
                    expected_hex, computed_hex
                )
            }
        }
    }
}

impl Error for IntegrityError {}
