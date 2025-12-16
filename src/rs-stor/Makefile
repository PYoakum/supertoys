.PHONY: help build run release test clean dev example

help:
	@echo "KV Store - Available commands:"
	@echo "  make build      - Build the project in debug mode"
	@echo "  make release    - Build optimized release binary"
	@echo "  make run        - Run the application (debug mode)"
	@echo "  make dev        - Run with example data"
	@echo "  make example    - Run with example data and custom settings"
	@echo "  make test       - Run tests"
	@echo "  make test-api   - Run API integration tests (requires running server)"
	@echo "  make clean      - Clean build artifacts"
	@echo "  make fmt        - Format code"
	@echo "  make clippy     - Run linter"

build:
	cargo build

release:
	cargo build --release
	@echo ""
	@echo "✅ Release binary available at: target/release/kv-store"

run:
	cargo run

dev:
	cargo run -- --file example_data.json

example:
	cargo run -- --capacity 52428800 --port 8080 --file example_data.json

test:
	cargo test

test-api:
	@echo "Make sure the server is running in another terminal!"
	@sleep 2
	./test_api.sh

clean:
	cargo clean

fmt:
	cargo fmt

clippy:
	cargo clippy -- -D warnings

# Quick start for first-time users
quickstart: build
	@echo ""
	@echo "🚀 Quick Start:"
	@echo "1. In this terminal, run: make dev"
	@echo "2. In another terminal, run: make test-api"
	@echo ""