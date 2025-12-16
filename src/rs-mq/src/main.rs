use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Message Queue Server - A simple web-based message queue
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to bind the server to
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// Logging mode: local, http, or both
    #[arg(short, long, default_value = "local")]
    log_mode: String,

    /// HTTP endpoint for remote logging (required if log_mode is http or both)
    #[arg(long)]
    log_endpoint: Option<String>,

    /// Log format: json or plaintext
    #[arg(long, default_value = "json")]
    log_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Message {
    id: String,
    payload: String,
    timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnqueueRequest {
    payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnqueueResponse {
    message_id: String,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DequeueResponse {
    message: Option<Message>,
    queue_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StatusResponse {
    queue_size: usize,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LogEntry {
    timestamp: String,
    level: String,
    message: String,
}

#[derive(Clone)]
struct AppState {
    queue: Arc<Mutex<VecDeque<Message>>>,
    config: Arc<LogConfig>,
}

#[derive(Clone)]
struct LogConfig {
    mode: String,
    endpoint: Option<String>,
    format: String,
}

impl AppState {
    fn new(log_config: LogConfig) -> Self {
        Self {
            queue: Arc::new(Mutex::new(VecDeque::new())),
            config: Arc::new(log_config),
        }
    }

    async fn log_event(&self, level: &str, message: &str) {
        let log_entry = LogEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            level: level.to_string(),
            message: message.to_string(),
        };

        // Local logging
        if self.config.mode == "local" || self.config.mode == "both" {
            match self.config.format.as_str() {
                "json" => {
                    if let Ok(json) = serde_json::to_string(&log_entry) {
                        println!("{}", json);
                    }
                }
                _ => {
                    println!("[{}] {} - {}", log_entry.timestamp, log_entry.level, log_entry.message);
                }
            }
        }

        // HTTP logging
        if (self.config.mode == "http" || self.config.mode == "both") && self.config.endpoint.is_some() {
            if let Some(endpoint) = &self.config.endpoint {
                let client = reqwest::Client::new();
                let body = match self.config.format.as_str() {
                    "json" => serde_json::to_string(&log_entry).unwrap_or_default(),
                    _ => format!("[{}] {} - {}", log_entry.timestamp, log_entry.level, log_entry.message),
                };

                let _ = client
                    .post(endpoint)
                    .header("Content-Type", if self.config.format == "json" { "application/json" } else { "text/plain" })
                    .body(body)
                    .send()
                    .await;
            }
        }
    }
}

// API Handlers

async fn health_check() -> Json<StatusResponse> {
    Json(StatusResponse {
        queue_size: 0,
        status: "healthy".to_string(),
    })
}

async fn enqueue(
    State(state): State<AppState>,
    Json(payload): Json<EnqueueRequest>,
) -> Result<(StatusCode, Json<EnqueueResponse>), StatusCode> {
    let message = Message {
        id: Uuid::new_v4().to_string(),
        payload: payload.payload.clone(),
        timestamp: chrono::Utc::now(),
    };

    let message_id = message.id.clone();
    
    {
        let mut queue = state.queue.lock().await;
        queue.push_back(message);
    }

    state.log_event("INFO", &format!("Message enqueued: {}", message_id)).await;
    info!("Message enqueued: {}", message_id);

    Ok((
        StatusCode::CREATED,
        Json(EnqueueResponse {
            message_id,
            status: "enqueued".to_string(),
        }),
    ))
}

async fn dequeue_get(
    State(state): State<AppState>,
) -> Result<Json<DequeueResponse>, StatusCode> {
    let mut queue = state.queue.lock().await;
    let message = queue.pop_front();
    let queue_size = queue.len();
    drop(queue);

    if let Some(ref msg) = message {
        state.log_event("INFO", &format!("Message dequeued: {}", msg.id)).await;
        info!("Message dequeued: {}", msg.id);
    } else {
        state.log_event("INFO", "Dequeue attempted on empty queue").await;
        info!("Dequeue attempted on empty queue");
    }

    Ok(Json(DequeueResponse {
        message,
        queue_size,
    }))
}

async fn dequeue_post(
    State(state): State<AppState>,
) -> Result<Json<DequeueResponse>, StatusCode> {
    dequeue_get(State(state)).await
}

async fn queue_status(
    State(state): State<AppState>,
) -> Json<StatusResponse> {
    let queue = state.queue.lock().await;
    let size = queue.len();
    drop(queue);

    Json(StatusResponse {
        queue_size: size,
        status: "ok".to_string(),
    })
}

async fn clear_queue(
    State(state): State<AppState>,
) -> Result<Json<StatusResponse>, StatusCode> {
    let mut queue = state.queue.lock().await;
    queue.clear();
    drop(queue);

    state.log_event("INFO", "Queue cleared").await;
    info!("Queue cleared");

    Ok(Json(StatusResponse {
        queue_size: 0,
        status: "cleared".to_string(),
    }))
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();

    // Validate configuration
    if (args.log_mode == "http" || args.log_mode == "both") && args.log_endpoint.is_none() {
        error!("Error: --log-endpoint is required when log-mode is 'http' or 'both'");
        std::process::exit(1);
    }

    let log_config = LogConfig {
        mode: args.log_mode.clone(),
        endpoint: args.log_endpoint.clone(),
        format: args.log_format.clone(),
    };

    let state = AppState::new(log_config);

    // Log startup information
    state.log_event("INFO", &format!("Starting Message Queue Server on port {}", args.port)).await;
    state.log_event("INFO", &format!("Log mode: {}", args.log_mode)).await;
    state.log_event("INFO", &format!("Log format: {}", args.log_format)).await;
    
    if let Some(ref endpoint) = args.log_endpoint {
        state.log_event("INFO", &format!("Log endpoint: {}", endpoint)).await;
    }

    info!("Starting Message Queue Server on port {}", args.port);
    info!("Log mode: {}", args.log_mode);
    info!("Log format: {}", args.log_format);

    // Build the router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/enqueue", post(enqueue))
        .route("/dequeue", get(dequeue_get).post(dequeue_post))
        .route("/status", get(queue_status))
        .route("/clear", post(clear_queue))
        .with_state(state.clone());

    let addr = format!("0.0.0.0:{}", args.port);
    
    state.log_event("INFO", &format!("Server listening on {}", addr)).await;
    info!("Server listening on {}", addr);

    axum::Server::bind(&addr.parse().unwrap())
        .serve(app.into_make_service())
        .await
        .expect("Failed to start server");
}