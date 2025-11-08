use anyhow::Result;
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, BufReader};

/// Compute a strong ETag for the file using SHA-256 hex, formatted as:
/// "sha256-<hex>"
pub async fn etag_for_file(path: &Path) -> Result<String> {
    let file = File::open(path).await?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];

    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    let hash = hasher.finalize();
    let hex = hex::encode(hash);
    Ok(format!("\"sha256-{}\"", hex))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn deterministic() {
        let mut tf = NamedTempFile::new().unwrap();
        tf.as_file_mut().write_all(b"hello world").unwrap();
        tf.as_file_mut().flush().unwrap();

        let p = tf.path().to_path_buf();
        let e1 = etag_for_file(&p).await.unwrap();
        let e2 = etag_for_file(&p).await.unwrap();
        assert_eq!(e1, e2);
        assert!(e1.starts_with("\"sha256-"), "etag format: {}", e1);
        assert!(e1.ends_with("\""));
    }
}
