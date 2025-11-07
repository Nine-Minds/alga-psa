use anyhow::{anyhow, Result};
use std::env;
use std::path::Path;
use tokio::fs;

/// Read EXT_STATIC_MAX_FILE_BYTES from env; return None if unset or invalid.
pub fn max_file_bytes_from_env() -> Option<u64> {
    match env::var("EXT_STATIC_MAX_FILE_BYTES") {
        Ok(v) => v.trim().parse().ok(),
        Err(_) => None,
    }
}

/// Enforce a maximum file size based on metadata length. Returns 413-like error.
pub async fn enforce_max_file_size(path: &Path, max: u64) -> Result<()> {
    let meta = fs::metadata(path).await?;
    let len = meta.len();
    if len > max {
        return Err(anyhow!("payload too large: {} > {}", len, max));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn env_parsing() {
        std::env::remove_var("EXT_STATIC_MAX_FILE_BYTES");
        assert_eq!(max_file_bytes_from_env(), None);

        std::env::set_var("EXT_STATIC_MAX_FILE_BYTES", "1000");
        assert_eq!(max_file_bytes_from_env(), Some(1000));

        std::env::set_var("EXT_STATIC_MAX_FILE_BYTES", "not-a-number");
        assert_eq!(max_file_bytes_from_env(), None);
    }

    #[tokio::test]
    async fn size_enforcement() {
        let mut tf = NamedTempFile::new().unwrap();
        tf.write_all(&vec![0u8; 10]).unwrap();
        let p = tf.path().to_path_buf();

        // ok when under
        enforce_max_file_size(&p, 20).await.unwrap();

        // error when over
        let err = enforce_max_file_size(&p, 5).await.unwrap_err();
        assert!(err.to_string().contains("payload too large"));
    }
}
