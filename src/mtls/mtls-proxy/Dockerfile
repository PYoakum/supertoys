# Multi-stage build for minimal image size
FROM rust:1.75-slim as builder

# Install build dependencies
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy manifests
COPY Cargo.toml Cargo.lock ./

# Copy source code
COPY src ./src

# Build for release
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y ca-certificates libssl3 && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 mtls-proxy

# Copy binary from builder
COPY --from=builder /app/target/release/mtls-proxy /usr/local/bin/mtls-proxy

# Create directory for certificates
RUN mkdir -p /etc/mtls-proxy && \
    chown mtls-proxy:mtls-proxy /etc/mtls-proxy

# Switch to non-root user
USER mtls-proxy

# Expose proxy port
EXPOSE 8443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD pgrep -x mtls-proxy || exit 1

# Default command (override with your own certificates and upstream)
ENTRYPOINT ["mtls-proxy"]
CMD ["--help"]