use anyhow::{Context, Result};
use clap::Parser;
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::WebPkiClientVerifier;
use rustls::RootCertStore;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;
use tracing::{debug, error, info, warn};
use rustls::crypto::CryptoProvider;


#[derive(Parser, Debug)]
#[command(
    name = "mtls-proxy",
    about = "A mutual TLS proxy server with client certificate authentication",
    version = "0.1.0"
)]
struct Args {
    /// Address to listen on
    #[arg(short, long, default_value = "0.0.0.0:8443")]
    listen: String,

    /// Upstream server URL (e.g., http://localhost:8080)
    #[arg(short, long)]
    upstream: String,

    /// Path to server certificate file (PEM format)
    #[arg(short = 'c', long)]
    server_cert: PathBuf,

    /// Path to server private key file (PEM format)
    #[arg(short = 'k', long)]
    server_key: PathBuf,

    /// Path to CA certificate for client verification (PEM format)
    #[arg(long)]
    client_ca: PathBuf,

    /// Require client certificates (enable mTLS)
    #[arg(long, default_value = "false")]
    require_client_cert: bool,

    /// Log level (error, warn, info, debug, trace)
    #[arg(long, default_value = "info")]
    log_level: String,

    /// Connection timeout in seconds
    #[arg(long, default_value = "30")]
    timeout: u64,
}

struct ProxyConfig {
    upstream_url: String,
    timeout: u64,
}

fn load_certs(path: &PathBuf) -> Result<Vec<CertificateDer<'static>>> {
    let cert_file = fs::read(path)
        .with_context(|| format!("Failed to read certificate file: {}", path.display()))?;

        
    let certs = rustls_pemfile::certs(&mut cert_file.as_slice())
        .collect::<Result<Vec<_>, _>>()
        .context("Failed to parse certificate")?;

    if certs.is_empty() {
        anyhow::bail!("No certificates found in file");
    }

    Ok(certs)
}

fn load_private_key(path: &PathBuf) -> Result<PrivateKeyDer<'static>> {
    let key_file = fs::read(path)
        .with_context(|| format!("Failed to read private key file: {}", path.display()))?;

    let mut reader = key_file.as_slice();

    loop {
        match rustls_pemfile::read_one(&mut reader)? {
            Some(rustls_pemfile::Item::Pkcs1Key(key)) => return Ok(key.into()),
            Some(rustls_pemfile::Item::Pkcs8Key(key)) => return Ok(key.into()),
            Some(rustls_pemfile::Item::Sec1Key(key)) => return Ok(key.into()),
            None => break,
            _ => {}
        }
    }

    anyhow::bail!("No valid private key found in file")
}

fn load_client_ca_certs(path: &PathBuf) -> Result<RootCertStore> {
    let ca_cert_file = fs::read(path)
        .with_context(|| format!("Failed to read CA certificate file: {}", path.display()))?;

    let mut root_store = RootCertStore::empty();
    let certs = rustls_pemfile::certs(&mut ca_cert_file.as_slice())
        .collect::<Result<Vec<_>, _>>()
        .context("Failed to parse CA certificate")?;

    for cert in certs {
        root_store.add(cert).context("Failed to add CA certificate to root store")?;
    }

    Ok(root_store)
}

fn setup_tls_acceptor(args: &Args) -> Result<TlsAcceptor> {
    info!("Loading server certificate from: {}", args.server_cert.display());
    let certs = load_certs(&args.server_cert)?;

    info!("Loading server private key from: {}", args.server_key.display());
    let key = load_private_key(&args.server_key)?;

    info!("Loading client CA certificate from: {}", args.client_ca.display());
    let client_root_store = load_client_ca_certs(&args.client_ca)?;

    let client_verifier = if args.require_client_cert {
        info!("Client certificate verification: REQUIRED");
        WebPkiClientVerifier::builder(Arc::new(client_root_store))
            .build()
            .context("Failed to build client verifier")?
    } else {
        warn!("Client certificate verification: OPTIONAL (not recommended for production)");
        WebPkiClientVerifier::builder(Arc::new(client_root_store))
            .build()
            .context("Failed to build client verifier")?
    };

    let mut config = rustls::ServerConfig::builder()
        .with_client_cert_verifier(client_verifier)
        .with_single_cert(certs, key)
        .context("Failed to create TLS config")?;

    // Set ALPN protocols
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    Ok(TlsAcceptor::from(Arc::new(config)))
}

async fn proxy_request(
    client_req: Request<Incoming>,
    config: Arc<ProxyConfig>,
) -> Result<Response<Full<Bytes>>> {
    let (parts, body) = client_req.into_parts();

    debug!(
        "Received request: {} {}",
        parts.method,
        parts.uri
    );

    // Build upstream URL
    let upstream_uri = build_upstream_uri(&config.upstream_url, &parts.uri)?;
    debug!("Forwarding to: {}", upstream_uri);

    // Read the entire body
    let body_bytes = body
        .collect()
        .await
        .context("Failed to read request body")?
        .to_bytes();

    // Create HTTP client
    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build_http();

    // Build upstream request
    let mut upstream_req = Request::builder()
        .method(parts.method.clone())
        .uri(upstream_uri);

    // Copy headers (excluding host and connection-related headers)
    for (name, value) in parts.headers.iter() {
        let name_str = name.as_str().to_lowercase();
        if !should_skip_header(&name_str) {
            upstream_req = upstream_req.header(name, value);
        }
    }

    let upstream_req = upstream_req
        .body(Full::new(body_bytes))
        .context("Failed to build upstream request")?;

    // Send request to upstream with timeout
    let upstream_response = tokio::time::timeout(
        tokio::time::Duration::from_secs(config.timeout),
        client.request(upstream_req),
    )
    .await
    .context("Upstream request timed out")?
    .context("Failed to send request to upstream")?;

    debug!("Upstream response status: {}", upstream_response.status());

    // Extract response parts
    let (upstream_parts, upstream_body) = upstream_response.into_parts();

    // Read upstream response body
    let upstream_bytes = upstream_body
        .collect()
        .await
        .context("Failed to read upstream response body")?
        .to_bytes();

    // Build client response
    let mut client_response = Response::builder()
        .status(upstream_parts.status);

    // Copy response headers
    for (name, value) in upstream_parts.headers.iter() {
        let name_str = name.as_str().to_lowercase();
        if !should_skip_header(&name_str) {
            client_response = client_response.header(name, value);
        }
    }

    let response = client_response
        .body(Full::new(upstream_bytes))
        .context("Failed to build client response")?;

    Ok(response)
}

fn build_upstream_uri(upstream_url: &str, original_uri: &Uri) -> Result<String> {
    let path_and_query = original_uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    let upstream_url = upstream_url.trim_end_matches('/');
    Ok(format!("{}{}", upstream_url, path_and_query))
}

fn should_skip_header(name: &str) -> bool {
    matches!(
        name,
        "connection" | "keep-alive" | "transfer-encoding" | "te" | "trailer" | "upgrade"
    )
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    tls_acceptor: TlsAcceptor,
    config: Arc<ProxyConfig>,
    peer_addr: SocketAddr,
) {
    // Perform TLS handshake
    let tls_stream = match tls_acceptor.accept(stream).await {
        Ok(stream) => stream,
        Err(e) => {
            error!("TLS handshake failed for {}: {}", peer_addr, e);
            return;
        }
    };

    debug!("TLS handshake successful for {}", peer_addr);

    // Get client certificate info if available
    /*
    let (io, conn_info) = tls_stream.into_inner();

    
    if let Some(certs) = conn_info.peer_certificates() {
        if !certs.is_empty() {
            info!("Client {} authenticated with certificate", peer_addr);
        }
    }
    */
    

    //let io = TokioIo::new(io);
    let io = TokioIo::new(tls_stream);

    // Create service function
    let service = service_fn(move |req| {
        let config = Arc::clone(&config);
        async move {
            match proxy_request(req, config).await {
                Ok(response) => Ok::<_, hyper::Error>(response),
                Err(e) => {
                    error!("Proxy error: {:#}", e);
                    let response = Response::builder()
                        .status(StatusCode::BAD_GATEWAY)
                        .body(Full::new(Bytes::from(format!("Proxy Error: {}", e))))
                        .unwrap();
                    Ok(response)
                }
            }
        }
    });

    // Serve the connection
    if let Err(e) = http1::Builder::new()
        .serve_connection(io, service)
        .await
    {
        error!("Error serving connection from {}: {}", peer_addr, e);
    }

    debug!("Connection closed for {}", peer_addr);
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    let _ = rustls::crypto::ring::default_provider().install_default();


    // Initialize tracing/logging
    let log_filter = format!("mtls_proxy={},tower_http={}", args.log_level, args.log_level);
    tracing_subscriber::fmt()
        .with_env_filter(log_filter)
        .with_target(false)
        .init();

    info!("Starting mTLS Proxy Server v{}", env!("CARGO_PKG_VERSION"));
    info!("Listening on: {}", args.listen);
    info!("Upstream server: {}", args.upstream);
    info!("Client certificate required: {}", args.require_client_cert);
    info!("Request timeout: {}s", args.timeout);

    // Setup TLS acceptor
    let tls_acceptor = setup_tls_acceptor(&args)?;

    // Create proxy configuration
    let config = Arc::new(ProxyConfig {
        upstream_url: args.upstream.clone(),
        timeout: args.timeout,
    });

    // Bind TCP listener
    let addr: SocketAddr = args
        .listen
        .parse()
        .context("Invalid listen address")?;

    let listener = TcpListener::bind(addr)
        .await
        .context("Failed to bind to address")?;

    info!("✓ Proxy server is ready and listening for connections");

    // Accept connections
    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                debug!("New connection from: {}", peer_addr);

                let tls_acceptor = tls_acceptor.clone();
                let config = Arc::clone(&config);

                tokio::spawn(async move {
                    handle_connection(stream, tls_acceptor, config, peer_addr).await;
                });
            }
            Err(e) => {
                error!("Failed to accept connection: {}", e);
            }
        }
    }
}