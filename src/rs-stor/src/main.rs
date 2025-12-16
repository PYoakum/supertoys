mod server;
mod store;

use anyhow::{Context, Result};
use clap::Parser;
use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::sync::Arc;
use store::MemoryStore;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Memory capacity in bytes (default: 10MB)
    #[arg(short, long, default_value = "10485760")]
    capacity: usize,

    /// Port to bind the web server to
    #[arg(short, long, default_value = "3000")]
    port: u16,

    /// Host to bind the web server to
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Path to JSON file to preload data from
    #[arg(short, long)]
    file: Option<String>,

    /// JSON string to preload data from
    #[arg(short, long)]
    json: Option<String>,
}

fn load_json_data(json_str: &str) -> Result<HashMap<String, String>> {
    let data: HashMap<String, String> = serde_json::from_str(json_str)
        .context("Failed to parse JSON data")?;
    Ok(data)
}

fn load_json_file(path: &str) -> Result<HashMap<String, String>> {
    let contents = fs::read_to_string(path)
        .context(format!("Failed to read file: {}", path))?;
    load_json_data(&contents)
}

#[tokio::main]
async fn main() -> Result<()> {
    // Parse command line arguments
    let args = Args::parse();

    println!("🚀 Initializing KV Store...");
    println!("   Memory Capacity: {} bytes ({:.2} MB)", 
             args.capacity, 
             args.capacity as f64 / 1_048_576.0);

    // Create memory store
    let store = Arc::new(MemoryStore::new(args.capacity));

    // Load initial data if provided
    if let Some(file_path) = args.file {
        println!("📂 Loading data from file: {}", file_path);
        match load_json_file(&file_path) {
            Ok(data) => {
                let count = data.len();
                match store.init_from_json(data) {
                    Ok(_) => println!("   ✓ Successfully loaded {} key-value pairs", count),
                    Err(e) => {
                        eprintln!("   ✗ Failed to load data: {}", e);
                        return Err(e.into());
                    }
                }
            }
            Err(e) => {
                eprintln!("   ✗ Failed to read file: {}", e);
                return Err(e);
            }
        }
    } else if let Some(json_str) = args.json {
        println!("📝 Loading data from JSON string");
        match load_json_data(&json_str) {
            Ok(data) => {
                let count = data.len();
                match store.init_from_json(data) {
                    Ok(_) => println!("   ✓ Successfully loaded {} key-value pairs", count),
                    Err(e) => {
                        eprintln!("   ✗ Failed to load data: {}", e);
                        return Err(e.into());
                    }
                }
            }
            Err(e) => {
                eprintln!("   ✗ Failed to parse JSON: {}", e);
                return Err(e);
            }
        }
    }

    // Print initial stats
    let stats = store.stats();
    println!("\n📊 Initial Statistics:");
    println!("   Entries: {}", stats.entry_count);
    println!("   Used Memory: {} bytes ({:.2} MB)", 
             stats.used_memory, 
             stats.used_memory as f64 / 1_048_576.0);
    println!("   Available Memory: {} bytes ({:.2} MB)", 
             stats.available_memory,
             stats.available_memory as f64 / 1_048_576.0);

    // Create router
    let app = server::create_router(store);

    // Setup server address
    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .context("Failed to parse address")?;

    println!("\n🌐 Starting web server...");
    println!("   Listening on: http://{}", addr);
    println!("\n📚 Available endpoints:");
    println!("   GET    /health          - Health check");
    println!("   GET    /stats           - Memory statistics");
    println!("   GET    /keys            - List all keys");
    println!("   GET    /keys/:key       - Get value for key");
    println!("   POST   /keys/:key       - Create/update key");
    println!("   PUT    /keys/:key       - Update existing key");
    println!("   DELETE /keys/:key       - Delete key");
    println!("   GET    /all             - Get all key-value pairs");
    println!("   POST   /clear           - Clear all data");
    println!("   POST   /bulk            - Bulk insert/update");
    println!("\n✨ Server is ready! Press Ctrl+C to stop.\n");

    // Start server
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("Failed to bind to address")?;

    axum::serve(listener, app)
        .await
        .context("Server error")?;

    Ok(())
}