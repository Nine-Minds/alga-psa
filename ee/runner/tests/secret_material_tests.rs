use alga_ext_runner::secrets::resolve_secret_material;
use alga_ext_runner::models::SecretEnvelope;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::{Map, Value};

fn make_envelope(values: &[(&str, &str)], version: Option<&str>) -> SecretEnvelope {
    let json_map: Map<String, Value> = values
        .iter()
        .map(|(k, v)| ((*k).to_string(), Value::String((*v).to_string())))
        .collect();
    let ciphertext = Value::Object(json_map);
    let ciphertext_b64 = BASE64_STANDARD.encode(ciphertext.to_string());
    SecretEnvelope {
        ciphertext_b64,
        version: version.map(|v| v.to_string()),
        algorithm: None,
        expires_at: None,
        key_path: None,
        mount: None,
    }
}

#[tokio::test]
async fn resolve_secret_material_returns_plaintext_map() -> anyhow::Result<()> {
    let envelope = make_envelope(&[("ALGA_API_KEY", "sk_test_123"), ("SERVICE_TOKEN", "abc123")], Some("v1"));

    let material = resolve_secret_material("tenant-a", "ext-alpha", Some("install-1"), &envelope)
        .await?;

    assert_eq!(material.values.get("ALGA_API_KEY"), Some(&"sk_test_123".to_string()));
    assert_eq!(material.values.get("SERVICE_TOKEN"), Some(&"abc123".to_string()));
    assert_eq!(material.version.as_deref(), Some("v1"));
    Ok(())
}

#[tokio::test]
async fn resolve_secret_material_updates_when_ciphertext_changes() -> anyhow::Result<()> {
    let envelope_v1 = make_envelope(&[("ALGA_API_KEY", "sk_old")], Some("v1"));
    let first = resolve_secret_material("tenant-a", "ext-beta", Some("install-99"), &envelope_v1).await?;
    assert_eq!(first.values.get("ALGA_API_KEY"), Some(&"sk_old".to_string()));

    let envelope_v2 = make_envelope(&[("ALGA_API_KEY", "sk_new"), ("ANALYTICS_TOKEN", "tok_8")], Some("v2"));
    let second = resolve_secret_material("tenant-a", "ext-beta", Some("install-99"), &envelope_v2).await?;

    assert_eq!(second.values.get("ALGA_API_KEY"), Some(&"sk_new".to_string()));
    assert_eq!(second.values.get("ANALYTICS_TOKEN"), Some(&"tok_8".to_string()));
    assert_eq!(second.version.as_deref(), Some("v2"));
    Ok(())
}
