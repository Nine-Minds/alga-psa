//! Alga PSA Endpoint Agent
//!
//! The Endpoint Agent runs on customer workstations to execute security
//! extensions in a sandboxed WebAssembly environment. It provides:
//!
//! - Read-only file system access for PII scanning
//! - Secure extension isolation with capability-based security
//! - Automatic extension updates with signature verification
//! - Server communication for job dispatch and result reporting

mod platform;
mod extension;
mod config;

use anyhow::{Context, Result};
use clap::Parser;
use std::time::Duration;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use config::{get_or_create_agent_id, AgentRegistration, Settings};
use extension::{ExtensionLoader, ExtensionRuntime, RuntimeConfig};

/// Alga PSA Endpoint Agent
#[derive(Parser, Debug)]
#[command(name = "alga-agent")]
#[command(version, about = "Alga PSA Endpoint Agent for security scanning")]
struct Args {
    /// Server URL to connect to
    #[arg(short, long, env = "ALGA_SERVER_URL")]
    server_url: Option<String>,

    /// Tenant ID
    #[arg(short, long, env = "ALGA_TENANT_ID")]
    tenant_id: Option<String>,

    /// Run once and exit (don't poll)
    #[arg(long)]
    once: bool,

    /// Enable debug logging
    #[arg(short, long, env = "ALGA_DEBUG")]
    debug: bool,

    /// Configuration file path
    #[arg(short, long)]
    config: Option<std::path::PathBuf>,
}

/// Agent state
struct Agent {
    /// Agent ID
    agent_id: config::AgentId,

    /// Settings
    settings: Settings,

    /// HTTP client
    client: reqwest::Client,

    /// Extension runtime
    runtime: ExtensionRuntime,

    /// Extension loader
    loader: ExtensionLoader,
}

impl Agent {
    /// Create a new agent instance
    async fn new(args: &Args) -> Result<Self> {
        // Load settings
        let mut settings = Settings::load().await?;

        // Override settings from CLI
        if let Some(url) = &args.server_url {
            settings.server_url = url.clone();
        }
        if let Some(tenant) = &args.tenant_id {
            settings.tenant_id = tenant.clone();
        }
        settings.debug = args.debug;

        // Load API key
        settings.load_api_key()?;

        // Get or create agent ID (F293)
        let agent_id = get_or_create_agent_id().await?;

        // Create HTTP client
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .context("Failed to create HTTP client")?;

        // Create extension runtime (F260, F261)
        let runtime_config = RuntimeConfig {
            debug: settings.debug,
            ..Default::default()
        };
        let runtime = ExtensionRuntime::new(runtime_config)?;

        // Create extension loader (F280-F282)
        let loader = ExtensionLoader::new()?;

        Ok(Self {
            agent_id,
            settings,
            client,
            runtime,
            loader,
        })
    }

    /// Register the agent with the server (F294)
    async fn register(&self) -> Result<config::AgentConfig> {
        let registration = AgentRegistration::from_agent_id(
            &self.agent_id,
            env!("CARGO_PKG_VERSION"),
        );

        let url = format!("{}/api/agents/register", self.settings.server_url);

        let mut request = self.client
            .post(&url)
            .json(&registration)
            .header("X-Tenant-ID", &self.settings.tenant_id);

        if let Some(api_key) = &self.settings.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request
            .send()
            .await
            .context("Failed to send registration request")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Registration failed: {} - {}", status, body);
        }

        let config: config::AgentConfig = response
            .json()
            .await
            .context("Failed to parse agent config")?;

        tracing::info!(
            agent_id = %self.agent_id.id,
            extensions = config.extensions.len(),
            "Agent registered successfully"
        );

        Ok(config)
    }

    /// Poll for jobs from the server
    async fn poll_jobs(&self) -> Result<Vec<Job>> {
        let url = format!(
            "{}/api/agents/{}/jobs",
            self.settings.server_url,
            self.agent_id.id
        );

        let mut request = self.client
            .get(&url)
            .header("X-Tenant-ID", &self.settings.tenant_id);

        if let Some(api_key) = &self.settings.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request
            .send()
            .await
            .context("Failed to poll for jobs")?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to poll jobs: {}", response.status());
        }

        let jobs: Vec<Job> = response.json().await?;
        Ok(jobs)
    }

    /// Execute a job
    async fn execute_job(&self, job: &Job) -> Result<JobResult> {
        tracing::info!(
            job_id = %job.job_id,
            extension_id = %job.extension_id,
            "Executing job"
        );

        // Load the extension (F280-F282)
        let manifest = extension::ExtensionManifest {
            extension_id: job.extension_id.clone(),
            version_id: job.version_id.clone(),
            content_hash: job.content_hash.clone(),
            download_url: job.download_url.clone(),
            size_bytes: job.size_bytes,
            signature: job.signature.clone(),
        };

        let wasm_bytes = self.loader.load_extension(&manifest).await?;

        // Load the component
        let component = self.runtime.load_component(&wasm_bytes)?;

        // Create a store with timeout (F261)
        let store = self.runtime.create_store(());

        // TODO: Instantiate and call the extension
        // This requires bindgen macros from wit-bindgen

        tracing::info!(
            job_id = %job.job_id,
            "Job completed"
        );

        Ok(JobResult {
            job_id: job.job_id.clone(),
            status: "completed".to_string(),
            output: serde_json::json!({"results": []}),
        })
    }

    /// Report job results to the server
    async fn report_result(&self, result: &JobResult) -> Result<()> {
        let url = format!(
            "{}/api/agents/{}/jobs/{}/result",
            self.settings.server_url,
            self.agent_id.id,
            result.job_id
        );

        let mut request = self.client
            .post(&url)
            .json(result)
            .header("X-Tenant-ID", &self.settings.tenant_id);

        if let Some(api_key) = &self.settings.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request.send().await?;

        if !response.status().is_success() {
            anyhow::bail!("Failed to report result: {}", response.status());
        }

        Ok(())
    }

    /// Run the agent's main loop
    async fn run(&self, once: bool) -> Result<()> {
        loop {
            // Poll for jobs
            match self.poll_jobs().await {
                Ok(jobs) => {
                    for job in jobs {
                        match self.execute_job(&job).await {
                            Ok(result) => {
                                if let Err(e) = self.report_result(&result).await {
                                    tracing::error!(
                                        job_id = %job.job_id,
                                        error = %e,
                                        "Failed to report job result"
                                    );
                                }
                            }
                            Err(e) => {
                                tracing::error!(
                                    job_id = %job.job_id,
                                    error = %e,
                                    "Job execution failed"
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to poll for jobs");
                }
            }

            if once {
                break;
            }

            // Wait before next poll
            tokio::time::sleep(Duration::from_secs(self.settings.poll_interval_seconds)).await;
        }

        Ok(())
    }
}

/// Job from the server
#[derive(Debug, serde::Deserialize)]
struct Job {
    job_id: String,
    extension_id: String,
    version_id: String,
    download_url: String,
    content_hash: String,
    size_bytes: u64,
    signature: Option<String>,
    config: serde_json::Value,
}

/// Job execution result
#[derive(Debug, serde::Serialize)]
struct JobResult {
    job_id: String,
    status: String,
    output: serde_json::Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    let filter = if args.debug {
        EnvFilter::new("debug")
    } else {
        EnvFilter::new("info")
    };

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "Starting Alga PSA Endpoint Agent"
    );

    // Create and initialize agent
    let agent = Agent::new(&args).await?;

    // Register with server
    let _config = agent.register().await?;

    // Run main loop
    agent.run(args.once).await?;

    Ok(())
}
