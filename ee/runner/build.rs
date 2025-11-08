use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // Best-effort: git SHA
    let git_sha = Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Best-effort: build timestamp (unix seconds)
    let build_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    println!("cargo:rustc-env=ALGA_BUILD_GIT_SHA={}", git_sha);
    println!("cargo:rustc-env=ALGA_BUILD_UNIX_SECS={}", build_unix);
}
