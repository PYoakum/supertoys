# mTLS Proxy - Mutual TLS Authentication Proxy Server

A high-performance, production-ready mutual TLS (mTLS) proxy server written in Rust. This proxy performs TLS termination, validates client certificates, and forwards requests to upstream servers.

## Features

- ✅ **TLS Termination**: Handles HTTPS connections with configurable server certificates
- ✅ **Mutual TLS Authentication**: Validates client certificates against a trusted CA
- ✅ **Request Proxying**: Forwards all request properties (method, headers, body, query params)
- ✅ **Response Proxying**: Returns upstream responses to clients unchanged
- ✅ **Async/Non-blocking**: Built on Tokio for high concurrency
- ✅ **HTTP/1.1 & HTTP/2**: Supports both protocols
- ✅ **Configurable Timeouts**: Prevent hanging connections
- ✅ **Structured Logging**: Debug and trace request flows
- ✅ **Robust Error Handling**: Graceful failure modes

## Architecture

```
Client (mTLS) → Proxy (TLS Termination + Auth) → Upstream (HTTP/HTTPS)
                ↑                                     ↓
                └─────────── Response ────────────────┘
```

The proxy:
1. Accepts TLS connections with client certificate verification
2. Validates client certificates against the configured CA
3. Terminates TLS and extracts the HTTP request
4. Forwards the request to the upstream server (preserving all properties)
5. Returns the upstream response to the client

## Installation

### Prerequisites

- Rust 1.70 or later
- Cargo

### Build from Source

```bash
cd mtls-proxy

# Build release binary
cargo build --release

# Binary will be at: target/release/mtls-proxy
```

## Usage

### Basic Usage

```bash
mtls-proxy \
  --listen 0.0.0.0:8443 \
  --upstream http://localhost:8080 \
  --server-cert server-cert.pem \
  --server-key server-key.pem \
  --client-ca ca-cert.pem
```

### CLI Options

```
Options:
  -l, --listen <LISTEN>
          Address to listen on
          [default: 0.0.0.0:8443]

  -u, --upstream <UPSTREAM>
          Upstream server URL (e.g., http://localhost:8080)

  -c, --server-cert <SERVER_CERT>
          Path to server certificate file (PEM format)

  -k, --server-key <SERVER_KEY>
          Path to server private key file (PEM format)

      --client-ca <CLIENT_CA>
          Path to CA certificate for client verification (PEM format)

      --require-client-cert <REQUIRE_CLIENT_CERT>
          Require client certificates (enable mTLS)
          [default: true]

      --log-level <LOG_LEVEL>
          Log level (error, warn, info, debug, trace)
          [default: info]

      --timeout <TIMEOUT>
          Connection timeout in seconds
          [default: 30]

  -h, --help
          Print help

  -V, --version
          Print version
```

## Certificate Setup

### Generate Test Certificates

Run the provided script to generate a complete certificate chain:

```bash
./setup-certs.sh
```

This creates:
- `certs/ca-cert.pem` - Certificate Authority
- `certs/ca-key.pem` - CA private key
- `certs/server-cert.pem` - Server certificate
- `certs/server-key.pem` - Server private key
- `certs/client-cert.pem` - Client certificate
- `certs/client-key.pem` - Client private key

### Manual Certificate Generation

```bash
# 1. Generate CA certificate
openssl req -x509 -newkey rsa:4096 -keyout ca-key.pem -out ca-cert.pem \
  -days 365 -nodes -subj "/CN=Test CA"

# 2. Generate server private key
openssl genrsa -out server-key.pem 4096

# 3. Generate server CSR
openssl req -new -key server-key.pem -out server-csr.pem \
  -subj "/CN=localhost"

# 4. Sign server certificate
openssl x509 -req -in server-csr.pem -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out server-cert.pem -days 365

# 5. Generate client private key
openssl genrsa -out client-key.pem 4096

# 6. Generate client CSR
openssl req -new -key client-key.pem -out client-csr.pem \
  -subj "/CN=Test Client"

# 7. Sign client certificate
openssl x509 -req -in client-csr.pem -CA ca-cert.pem -CAkey ca-key.pem \
  -CAcreateserial -out client-cert.pem -days 365
```

## Examples

### Example 1: Basic Setup with Test Upstream

```bash
# Terminal 1: Start a simple upstream server
python3 -m http.server 8080

# Terminal 2: Start the proxy
./target/release/mtls-proxy \
  --listen 127.0.0.1:8443 \
  --upstream http://localhost:8080 \
  --server-cert certs/server-cert.pem \
  --server-key certs/server-key.pem \
  --client-ca certs/ca-cert.pem \
  --log-level debug

# Terminal 3: Test with curl
curl --cacert certs/ca-cert.pem \
  --cert certs/client-cert.pem \
  --key certs/client-key.pem \
  https://localhost:8443/
```

### Example 2: Proxy to External API

```bash
# Proxy to an external HTTPS API
./target/release/mtls-proxy \
  --listen 0.0.0.0:8443 \
  --upstream https://api.example.com \
  --server-cert certs/server-cert.pem \
  --server-key certs/server-key.pem \
  --client-ca certs/ca-cert.pem

# Client connects with mTLS, proxy forwards to external API
curl --cacert certs/ca-cert.pem \
  --cert certs/client-cert.pem \
  --key certs/client-key.pem \
  https://localhost:8443/v1/endpoint
```

### Example 3: Testing with the mTLS Client

If you also have the `mtls-client` tool:

```bash
# Start proxy
./target/release/mtls-proxy \
  --listen 127.0.0.1:8443 \
  --upstream http://httpbin.org \
  --server-cert certs/server-cert.pem \
  --server-key certs/server-key.pem \
  --client-ca certs/ca-cert.pem

# Use mtls-client to connect
mtls-client \
  --url https://localhost:8443/get \
  --cert certs/client-cert.pem \
  --key certs/client-key.pem \
  --ca-cert certs/ca-cert.pem
```

### Example 4: Production Setup

```bash
# Production configuration with proper logging
./target/release/mtls-proxy \
  --listen 0.0.0.0:8443 \
  --upstream http://backend-service:8080 \
  --server-cert /etc/ssl/certs/server.pem \
  --server-key /etc/ssl/private/server-key.pem \
  --client-ca /etc/ssl/certs/client-ca.pem \
  --require-client-cert true \
  --timeout 60 \
  --log-level info
```

## Request Flow

The proxy preserves all request properties:

### Preserved Request Properties
- HTTP Method (GET, POST, PUT, DELETE, etc.)
- Request path and query parameters
- All headers (except connection-related ones)
- Request body
- Content-Type and other content headers

### Filtered Headers
The proxy filters out connection-specific headers that shouldn't be forwarded:
- `connection`
- `keep-alive`
- `transfer-encoding`
- `te`
- `trailer`
- `upgrade`

### Response Handling
- All response headers are preserved
- Response body is streamed back unchanged
- Status codes are preserved
- Content-Type and other metadata headers are maintained

## Testing

### Run the Test Script

```bash
./test-proxy.sh
```

This script will:
1. Generate certificates if needed
2. Start a test upstream server
3. Start the proxy
4. Run various test requests
5. Verify the proxy is working correctly

### Manual Testing

```bash
# Test with curl
curl -v --cacert certs/ca-cert.pem \
  --cert certs/client-cert.pem \
  --key certs/client-key.pem \
  https://localhost:8443/endpoint

# Test POST request
curl -v --cacert certs/ca-cert.pem \
  --cert certs/client-cert.pem \
  --key certs/client-key.pem \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}' \
  https://localhost:8443/api/endpoint

# Test without client certificate (should fail)
curl -v --cacert certs/ca-cert.pem \
  https://localhost:8443/
```

## Logging Levels

Control the verbosity of logging:

- **error**: Only critical errors
- **warn**: Warnings and errors
- **info**: General information (default)
- **debug**: Detailed debugging information
- **trace**: Very detailed tracing

```bash
# Debug mode for troubleshooting
./target/release/mtls-proxy \
  --listen 0.0.0.0:8443 \
  --upstream http://localhost:8080 \
  --server-cert server-cert.pem \
  --server-key server-key.pem \
  --client-ca ca-cert.pem \
  --log-level debug
```

## Performance Considerations

The proxy is built on Tokio and uses async I/O throughout:

- **Concurrent Connections**: Handles thousands of concurrent connections
- **Non-blocking**: All I/O operations are non-blocking
- **Connection Pooling**: Reuses connections to upstream servers
- **Efficient Memory Usage**: Streams request/response bodies

### Benchmarking

You can benchmark the proxy using tools like `wrk` or `hey`:

```bash
# Using hey
hey -n 10000 -c 100 \
  -cacert certs/ca-cert.pem \
  -cert certs/client-cert.pem \
  -key certs/client-key.pem \
  https://localhost:8443/
```

## Production Deployment

### Systemd Service

Create `/etc/systemd/system/mtls-proxy.service`:

```ini
[Unit]
Description=mTLS Proxy Server
After=network.target

[Service]
Type=simple
User=mtls-proxy
Group=mtls-proxy
WorkingDirectory=/opt/mtls-proxy
ExecStart=/opt/mtls-proxy/mtls-proxy \
  --listen 0.0.0.0:8443 \
  --upstream http://localhost:8080 \
  --server-cert /etc/mtls-proxy/server-cert.pem \
  --server-key /etc/mtls-proxy/server-key.pem \
  --client-ca /etc/mtls-proxy/ca-cert.pem \
  --log-level info
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Docker Deployment

```dockerfile
FROM rust:1.75 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/mtls-proxy /usr/local/bin/
ENTRYPOINT ["mtls-proxy"]
```

```bash
# Build
docker build -t mtls-proxy .

# Run
docker run -d \
  -p 8443:8443 \
  -v /path/to/certs:/certs \
  mtls-proxy \
  --listen 0.0.0.0:8443 \
  --upstream http://backend:8080 \
  --server-cert /certs/server-cert.pem \
  --server-key /certs/server-key.pem \
  --client-ca /certs/ca-cert.pem
```

## Security Best Practices

1. **Protect Private Keys**: Store server and client keys with restricted permissions
   ```bash
   chmod 600 server-key.pem client-key.pem
   ```

2. **Regular Certificate Rotation**: Rotate certificates before expiration

3. **Strong Cipher Suites**: The proxy uses modern TLS 1.3 by default

4. **Certificate Revocation**: Implement CRL or OCSP checking if needed

5. **Principle of Least Privilege**: Run the proxy with minimal permissions

6. **Monitor Logs**: Set up log aggregation and alerting

7. **Keep Updated**: Regularly update dependencies for security patches

## Troubleshooting

### TLS Handshake Failures

```bash
# Check certificate validity
openssl x509 -in server-cert.pem -text -noout

# Verify certificate chain
openssl verify -CAfile ca-cert.pem server-cert.pem

# Test TLS connection
openssl s_client -connect localhost:8443 \
  -cert client-cert.pem \
  -key client-key.pem \
  -CAfile ca-cert.pem
```

### Connection Issues

```bash
# Test if port is listening
netstat -tuln | grep 8443

# Check upstream connectivity
curl -v http://localhost:8080

# Run with debug logging
./target/release/mtls-proxy --log-level debug ...
```

### Certificate Mismatch

If you get "certificate verify failed" errors:
1. Ensure client certificate is signed by the CA specified in `--client-ca`
2. Check that server certificate matches the hostname
3. Verify certificate dates are valid

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

MIT License

## Support

For issues, questions, or contributions, please open an issue on the project repository.