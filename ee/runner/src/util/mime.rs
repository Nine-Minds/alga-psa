use axum::http::HeaderValue;
use std::path::Path;

/// Resolve Content-Type using mime_guess, defaulting to application/octet-stream.
pub fn content_type_for(path: &Path) -> HeaderValue {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    // It's safe to unwrap since mime types are valid header values
    HeaderValue::from_str(mime.essence_str())
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn common_mappings() {
        let cases = vec![
            ("index.html", "text/html"),
            // mime_guess returns text/javascript for .js
            ("app.js", "text/javascript"),
            ("styles.css", "text/css"),
            ("data.json", "application/json"),
            ("image.svg", "image/svg+xml"),
            ("image.png", "image/png"),
            ("font.woff2", "font/woff2"),
        ];

        for (name, expected_prefix) in cases {
            let ct = content_type_for(&PathBuf::from(name));
            let s = ct.to_str().unwrap();
            assert!(
                s.starts_with(expected_prefix),
                "got {} expected prefix {}",
                s,
                expected_prefix
            );
        }

        // Unknown extension falls back
        let ct = content_type_for(&PathBuf::from("file.unknownext"));
        assert_eq!(ct.to_str().unwrap(), "application/octet-stream");
    }
}
