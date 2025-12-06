//! WebSocket signaling client for connecting to the server

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{sleep, Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

/// Messages sent/received through the signaling channel
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignalingMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(rename = "sessionId", skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(rename = "senderId", skip_serializing_if = "Option::is_none")]
    pub sender_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(rename = "engineerId", skip_serializing_if = "Option::is_none")]
    pub engineer_id: Option<String>,
}

/// Events emitted by the signaling client
#[derive(Debug, Clone)]
pub enum SignalingEvent {
    Connected,
    Disconnected,
    Error(String),
    SessionRequest { session_id: String, engineer_id: String },
    Offer { session_id: String, sdp: String },
    Answer { session_id: String, sdp: String },
    IceCandidate { session_id: String, candidate: serde_json::Value },
}

/// State of the signaling connection
#[derive(Debug, Clone, PartialEq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// WebSocket signaling client
pub struct SignalingClient {
    ws_url: String,
    connection_token: String,
    state: Arc<Mutex<ConnectionState>>,
    event_tx: mpsc::Sender<SignalingEvent>,
    message_tx: Arc<Mutex<Option<mpsc::Sender<SignalingMessage>>>>,
    reconnect_interval: Duration,
    max_reconnect_attempts: u32,
}

impl SignalingClient {
    pub fn new(
        ws_url: String,
        connection_token: String,
        event_tx: mpsc::Sender<SignalingEvent>,
        reconnect_interval_ms: u64,
        max_reconnect_attempts: u32,
    ) -> Self {
        SignalingClient {
            ws_url,
            connection_token,
            state: Arc::new(Mutex::new(ConnectionState::Disconnected)),
            event_tx,
            message_tx: Arc::new(Mutex::new(None)),
            reconnect_interval: Duration::from_millis(reconnect_interval_ms),
            max_reconnect_attempts,
        }
    }

    /// Start the signaling client connection loop
    pub async fn connect(&self) -> Result<()> {
        let mut reconnect_attempts = 0;

        loop {
            {
                let mut state = self.state.lock().await;
                if *state == ConnectionState::Disconnected {
                    *state = ConnectionState::Connecting;
                } else if *state == ConnectionState::Reconnecting {
                    // Already reconnecting, continue
                } else {
                    // Already connected or connecting
                    return Ok(());
                }
            }

            let url = format!(
                "{}?token={}&role=agent",
                self.ws_url, self.connection_token
            );

            info!("Connecting to signaling server: {}", self.ws_url);

            match self.connect_once(&url).await {
                Ok(()) => {
                    reconnect_attempts = 0;
                    // Connection was established but then closed normally
                }
                Err(e) => {
                    error!("WebSocket connection error: {}", e);
                    let _ = self.event_tx.send(SignalingEvent::Error(e.to_string())).await;
                }
            }

            // Handle reconnection
            reconnect_attempts += 1;
            if reconnect_attempts > self.max_reconnect_attempts {
                error!("Max reconnection attempts ({}) reached", self.max_reconnect_attempts);
                {
                    let mut state = self.state.lock().await;
                    *state = ConnectionState::Disconnected;
                }
                return Err(anyhow::anyhow!("Failed to connect after {} attempts", self.max_reconnect_attempts));
            }

            {
                let mut state = self.state.lock().await;
                *state = ConnectionState::Reconnecting;
            }

            info!(
                "Reconnecting in {:?} (attempt {}/{})",
                self.reconnect_interval, reconnect_attempts, self.max_reconnect_attempts
            );
            sleep(self.reconnect_interval).await;
        }
    }

    /// Establish a single WebSocket connection
    async fn connect_once(&self, url: &str) -> Result<()> {
        let parsed_url = Url::parse(url).context("Invalid WebSocket URL")?;
        let (ws_stream, _) = connect_async(parsed_url).await?;

        info!("WebSocket connection established");

        let (mut write, mut read) = ws_stream.split();

        // Create channel for sending messages
        let (msg_tx, mut msg_rx) = mpsc::channel::<SignalingMessage>(32);
        {
            let mut message_tx = self.message_tx.lock().await;
            *message_tx = Some(msg_tx);
        }

        {
            let mut state = self.state.lock().await;
            *state = ConnectionState::Connected;
        }

        let _ = self.event_tx.send(SignalingEvent::Connected).await;

        // Spawn task to send outgoing messages
        let send_task = tokio::spawn(async move {
            while let Some(msg) = msg_rx.recv().await {
                let json = serde_json::to_string(&msg).unwrap_or_default();
                if let Err(e) = write.send(Message::Text(json)).await {
                    error!("Failed to send message: {}", e);
                    break;
                }
            }
        });

        // Handle incoming messages
        while let Some(message) = read.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    debug!("Received: {}", text);
                    if let Err(e) = self.handle_message(&text).await {
                        warn!("Failed to handle message: {}", e);
                    }
                }
                Ok(Message::Close(_)) => {
                    info!("WebSocket connection closed by server");
                    break;
                }
                Ok(Message::Ping(data)) => {
                    // Pong is handled automatically by the library
                    debug!("Received ping");
                }
                Ok(Message::Pong(_)) => {
                    debug!("Received pong");
                }
                Ok(_) => {}
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
            }
        }

        // Clean up
        send_task.abort();
        {
            let mut message_tx = self.message_tx.lock().await;
            *message_tx = None;
        }
        {
            let mut state = self.state.lock().await;
            *state = ConnectionState::Disconnected;
        }

        let _ = self.event_tx.send(SignalingEvent::Disconnected).await;

        Ok(())
    }

    /// Handle an incoming signaling message
    async fn handle_message(&self, message: &str) -> Result<()> {
        let msg: SignalingMessage = serde_json::from_str(message)?;

        match msg.msg_type.as_str() {
            "connected" => {
                info!("Successfully authenticated with signaling server");
            }
            "session-request" => {
                if let (Some(session_id), Some(engineer_id)) = (msg.session_id, msg.engineer_id) {
                    info!("Received session request: {} from {}", session_id, engineer_id);
                    let _ = self.event_tx.send(SignalingEvent::SessionRequest {
                        session_id,
                        engineer_id,
                    }).await;
                }
            }
            "offer" => {
                if let (Some(session_id), Some(payload)) = (msg.session_id.clone(), msg.payload) {
                    if let Some(sdp) = payload.get("sdp").and_then(|v| v.as_str()) {
                        let _ = self.event_tx.send(SignalingEvent::Offer {
                            session_id,
                            sdp: sdp.to_string(),
                        }).await;
                    }
                }
            }
            "answer" => {
                if let (Some(session_id), Some(payload)) = (msg.session_id.clone(), msg.payload) {
                    if let Some(sdp) = payload.get("sdp").and_then(|v| v.as_str()) {
                        let _ = self.event_tx.send(SignalingEvent::Answer {
                            session_id,
                            sdp: sdp.to_string(),
                        }).await;
                    }
                }
            }
            "ice-candidate" => {
                if let (Some(session_id), Some(payload)) = (msg.session_id.clone(), msg.payload) {
                    let _ = self.event_tx.send(SignalingEvent::IceCandidate {
                        session_id,
                        candidate: payload,
                    }).await;
                }
            }
            "error" => {
                let error_msg = msg.message.unwrap_or_else(|| "Unknown error".to_string());
                error!("Signaling error: {}", error_msg);
                let _ = self.event_tx.send(SignalingEvent::Error(error_msg)).await;
            }
            _ => {
                debug!("Unknown message type: {}", msg.msg_type);
            }
        }

        Ok(())
    }

    /// Send a signaling message
    pub async fn send(&self, message: SignalingMessage) -> Result<()> {
        let tx = self.message_tx.lock().await;
        if let Some(ref sender) = *tx {
            sender.send(message).await
                .context("Failed to send signaling message")?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("Not connected"))
        }
    }

    /// Send a session accept message
    pub async fn accept_session(&self, session_id: &str) -> Result<()> {
        self.send(SignalingMessage {
            msg_type: "session-accept".to_string(),
            session_id: Some(session_id.to_string()),
            sender_id: None,
            payload: None,
            timestamp: Some(chrono::Utc::now().timestamp_millis() as u64),
            message: None,
            role: None,
            user_id: None,
            engineer_id: None,
        }).await
    }

    /// Send a session deny message
    pub async fn deny_session(&self, session_id: &str) -> Result<()> {
        self.send(SignalingMessage {
            msg_type: "session-deny".to_string(),
            session_id: Some(session_id.to_string()),
            sender_id: None,
            payload: None,
            timestamp: Some(chrono::Utc::now().timestamp_millis() as u64),
            message: None,
            role: None,
            user_id: None,
            engineer_id: None,
        }).await
    }

    /// Send an SDP answer
    pub async fn send_answer(&self, session_id: &str, sdp: &str) -> Result<()> {
        self.send(SignalingMessage {
            msg_type: "answer".to_string(),
            session_id: Some(session_id.to_string()),
            sender_id: Some("agent".to_string()),
            payload: Some(serde_json::json!({
                "type": "answer",
                "sdp": sdp
            })),
            timestamp: Some(chrono::Utc::now().timestamp_millis() as u64),
            message: None,
            role: None,
            user_id: None,
            engineer_id: None,
        }).await
    }

    /// Send an ICE candidate
    pub async fn send_ice_candidate(&self, session_id: &str, candidate: serde_json::Value) -> Result<()> {
        self.send(SignalingMessage {
            msg_type: "ice-candidate".to_string(),
            session_id: Some(session_id.to_string()),
            sender_id: Some("agent".to_string()),
            payload: Some(candidate),
            timestamp: Some(chrono::Utc::now().timestamp_millis() as u64),
            message: None,
            role: None,
            user_id: None,
            engineer_id: None,
        }).await
    }

    /// Get the current connection state
    pub async fn get_state(&self) -> ConnectionState {
        self.state.lock().await.clone()
    }

    /// Check if connected
    pub async fn is_connected(&self) -> bool {
        *self.state.lock().await == ConnectionState::Connected
    }
}
