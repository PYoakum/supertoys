use axum::{
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Router,
};
use chrono::Local;
use clap::Parser;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

/// A simple CLI tool that creates a localhost server to receive and log payloads
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// Path to the log file
    #[arg(short, long, default_value = "server.log")]
    log_file: PathBuf,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Clone)]
struct AppState {
    log_file: Arc<Mutex<PathBuf>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize tracing
    let log_level = if args.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(log_level)
        .init();

    // Create or verify log file exists
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&args.log_file)?;

    info!("Log file: {:?}", args.log_file);

    let state = AppState {
        log_file: Arc::new(Mutex::new(args.log_file)),
    };

    // Build the router
    let app = Router::new()
        .route("/log", post(handle_log))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));
    info!("Starting server on {}", addr);
    info!("Send POST requests to http://localhost:{}/log", args.port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<StatusCode, (StatusCode, String)> {
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/plain");

    info!("Received request with Content-Type: {}", content_type);

    // Determine payload type and process accordingly
    let log_entry = match content_type {
        ct if ct.contains("application/json") => {
            // Try to parse as JSON to validate
            match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(json) => {
                    format!("[JSON] {}", serde_json::to_string_pretty(&json).unwrap())
                }
                Err(e) => {
                    warn!("Failed to parse JSON: {}", e);
                    return Err((
                        StatusCode::BAD_REQUEST,
                        format!("Invalid JSON: {}", e),
                    ));
                }
            }
        }
        ct if ct.contains("application/x-ndjson") || ct.contains("application/jsonlines") => {
            // Process ND-JSON (newline-delimited JSON)
            let mut entries = Vec::new();
            for (idx, line) in body.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(line) {
                    Ok(json) => entries.push(json.to_string()),
                    Err(e) => {
                        warn!("Failed to parse ND-JSON line {}: {}", idx + 1, e);
                        return Err((
                            StatusCode::BAD_REQUEST,
                            format!("Invalid ND-JSON at line {}: {}", idx + 1, e),
                        ));
                    }
                }
            }
            format!("[ND-JSON] {}", entries.join("\n          "))
        }
        _ => {
            // Treat as plain string
            format!("[STRING] {}", body)
        }
    };

    // Write to log file
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let formatted_entry = format!("[{}] {}\n", timestamp, log_entry);

    let log_file_path = state.log_file.lock().await;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&*log_file_path)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open log file: {}", e),
            )
        })?;

    file.write_all(formatted_entry.as_bytes())
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to write to log file: {}", e),
            )
        })?;

    info!("Successfully logged entry");
    Ok(StatusCode::OK)
}