#!/bin/bash

# Comprehensive test script for mTLS proxy
# This script sets up, runs, and tests the proxy server

set -e

# Disable job control messages
set +m

CERT_DIR="./certs"
PROXY_PORT=8443
UPSTREAM_PORT=8080
TEST_FILE="/tmp/mtls-proxy-test-upstream.py"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "======================================"
echo "mTLS Proxy Test Suite"
echo "======================================"
echo ""
echo "This script will:"
echo "  1. Check dependencies"
echo "  2. Generate certificates (if needed)"
echo "  3. Build the proxy"
echo "  4. Start test servers"
echo "  5. Run comprehensive tests"
echo "  6. Clean up automatically"
echo ""

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Cleanup function
cleanup() {
    print_info "Cleaning up..."
    
    # Kill proxy if running (suppress job control messages)
    if [ ! -z "$PROXY_PID" ]; then
        kill $PROXY_PID 2>/dev/null || true
        wait $PROXY_PID 2>/dev/null || true
        print_info "Stopped proxy server"
    fi
    
    # Kill upstream if running (suppress job control messages)
    if [ ! -z "$UPSTREAM_PID" ]; then
        kill $UPSTREAM_PID 2>/dev/null || true
        wait $UPSTREAM_PID 2>/dev/null || true
        print_info "Stopped upstream server"
    fi
    
    # Remove test file
    rm -f "$TEST_FILE"
    
    echo ""
}

trap cleanup EXIT

# Step 1: Check dependencies
echo "Step 1: Checking dependencies"
echo "------------------------------"

if ! command -v cargo &> /dev/null; then
    print_error "cargo not found. Please install Rust."
    exit 1
fi
print_success "cargo found"

if ! command -v openssl &> /dev/null; then
    print_error "openssl not found. Please install OpenSSL."
    exit 1
fi
print_success "openssl found"

if ! command -v curl &> /dev/null; then
    print_error "curl not found. Please install curl."
    exit 1
fi
print_success "curl found"

if ! command -v python3 &> /dev/null; then
    print_error "python3 not found. Please install Python 3."
    exit 1
fi
print_success "python3 found"

echo ""

# Step 2: Generate certificates if needed
echo "Step 2: Setting up certificates"
echo "--------------------------------"

if [ ! -f "$CERT_DIR/ca-cert.pem" ] || [ ! -f "$CERT_DIR/server-cert.pem" ] || [ ! -f "$CERT_DIR/client-cert.pem" ]; then
    print_info "Certificates not found, generating..."
    chmod +x ./setup-certs.sh
    ./setup-certs.sh > /dev/null 2>&1
    print_success "Certificates generated"
else
    print_success "Certificates already exist"
fi

echo ""

# Step 3: Build the proxy
echo "Step 3: Building the proxy"
echo "--------------------------"

print_info "Building release binary..."
cargo build --release 2>&1 | grep -E "(Compiling|Finished)" || true
print_success "Proxy built successfully"

echo ""

# Step 4: Create test upstream server
echo "Step 4: Setting up test upstream server"
echo "----------------------------------------"

cat > "$TEST_FILE" <<'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import sys

class TestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default logging
        pass
    
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        response = {
            'method': 'GET',
            'path': self.path,
            'headers': dict(self.headers),
            'message': 'Hello from upstream server'
        }
        self.wfile.write(json.dumps(response, indent=2).encode())
    
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        response = {
            'method': 'POST',
            'path': self.path,
            'headers': dict(self.headers),
            'body': body,
            'message': 'POST received by upstream'
        }
        self.wfile.write(json.dumps(response, indent=2).encode())
    
    def do_PUT(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        response = {
            'method': 'PUT',
            'path': self.path,
            'body': body,
            'message': 'PUT received by upstream'
        }
        self.wfile.write(json.dumps(response, indent=2).encode())
    
    def do_DELETE(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        
        response = {
            'method': 'DELETE',
            'path': self.path,
            'message': 'DELETE received by upstream'
        }
        self.wfile.write(json.dumps(response, indent=2).encode())

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(('127.0.0.1', port), TestHandler)
    print(f'Upstream server listening on port {port}', flush=True)
    server.serve_forever()
EOF

# Start upstream server
print_info "Starting upstream server on port $UPSTREAM_PORT..."
python3 "$TEST_FILE" $UPSTREAM_PORT 2>&1 | grep -v "Serving HTTP" &
UPSTREAM_PID=$!
sleep 3

# Verify upstream is running and responding correctly
UPSTREAM_TEST=$(curl -s http://localhost:$UPSTREAM_PORT/ 2>&1)
if [ $? -ne 0 ]; then
    print_error "Failed to connect to upstream server"
    kill $UPSTREAM_PID 2>/dev/null || true
    exit 1
fi

# Check if we're getting the expected JSON response
if ! echo "$UPSTREAM_TEST" | grep -q "Hello from upstream"; then
    print_error "Upstream server not returning expected responses"
    echo "Got: $UPSTREAM_TEST"
    kill $UPSTREAM_PID 2>/dev/null || true
    exit 1
fi

print_success "Upstream server is running (PID: $UPSTREAM_PID)"

echo ""

# Step 5: Start the proxy
echo "Step 5: Starting the proxy server"
echo "----------------------------------"

print_info "Starting proxy on port $PROXY_PORT..."
./target/release/mtls-proxy \
    --listen "127.0.0.1:$PROXY_PORT" \
    --upstream "http://localhost:$UPSTREAM_PORT" \
    --server-cert "$CERT_DIR/server-cert.pem" \
    --server-key "$CERT_DIR/server-key.pem" \
    --client-ca "$CERT_DIR/ca-cert.pem" \
    --log-level warn \
    > /dev/null 2>&1 &
PROXY_PID=$!
sleep 3

# Verify proxy is running
if ! ps -p $PROXY_PID > /dev/null; then
    print_error "Failed to start proxy server"
    exit 1
fi
print_success "Proxy server is running (PID: $PROXY_PID)"

echo ""

# Step 6: Run tests
echo "Step 6: Running tests"
echo "---------------------"
echo ""

TEST_COUNT=0
PASS_COUNT=0
VERBOSE=${VERBOSE:-0}

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TEST_COUNT=$((TEST_COUNT + 1))
    print_info "Test $TEST_COUNT: $test_name"
    
    # Run the test and capture output
    TEST_OUTPUT=$(eval "$test_command" 2>&1)
    TEST_EXIT=$?
    
    if [ $TEST_EXIT -eq 0 ]; then
        print_success "PASSED"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        print_error "FAILED"
        if [ "$VERBOSE" = "1" ]; then
            echo "  Command: $test_command"
            echo "  Output: $TEST_OUTPUT"
        fi
    fi
    echo ""
}

# Test 1: Basic GET request with mTLS
run_test "Basic GET request with mTLS" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     https://localhost:$PROXY_PORT/ | grep 'Hello from upstream'"

# Test 2: GET request with query parameters
run_test "GET request with query parameters" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     'https://localhost:$PROXY_PORT/test?param1=value1&param2=value2' | grep 'param1=value1'"

# Test 3: POST request with JSON body
run_test "POST request with JSON body" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     -X POST \
     -H 'Content-Type: application/json' \
     -d '{\"test\": \"data\"}' \
     https://localhost:$PROXY_PORT/api/endpoint | grep 'POST received'"

# Test 4: PUT request
run_test "PUT request with data" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     -X PUT \
     -d 'update data' \
     https://localhost:$PROXY_PORT/resource/123 | grep 'PUT received'"

# Test 5: DELETE request
run_test "DELETE request" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     -X DELETE \
     https://localhost:$PROXY_PORT/resource/123 | grep 'DELETE received'"

# Test 6: Custom headers forwarding
run_test "Custom headers forwarding" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     -H 'X-Custom-Header: test-value' \
     https://localhost:$PROXY_PORT/ | grep 'X-Custom-Header'"

# Test 7: Request without client certificate (should fail)
print_info "Test $((TEST_COUNT + 1)): Request without client certificate (should fail)"
TEST_COUNT=$((TEST_COUNT + 1))

if curl -s --cacert $CERT_DIR/ca-cert.pem \
   https://localhost:$PROXY_PORT/ > /dev/null 2>&1; then
    print_error "FAILED (request should have been rejected)"
else
    print_success "PASSED (request correctly rejected)"
    PASS_COUNT=$((PASS_COUNT + 1))
fi
echo ""

# Test 8: Path preservation
run_test "Path preservation" \
    "curl -s --cacert $CERT_DIR/ca-cert.pem \
     --cert $CERT_DIR/client-cert.pem \
     --key $CERT_DIR/client-key.pem \
     https://localhost:$PROXY_PORT/api/v1/users/123 | grep '/api/v1/users/123'"

# Test summary
echo "======================================"
echo "Test Results"
echo "======================================"
echo ""
echo "Total Tests: $TEST_COUNT"
echo "Passed:      $PASS_COUNT"
echo "Failed:      $((TEST_COUNT - PASS_COUNT))"
echo ""

if [ $PASS_COUNT -eq $TEST_COUNT ]; then
    print_success "All tests passed! 🎉"
    echo ""
    exit 0
else
    print_error "Some tests failed"
    echo ""
    exit 1
fi