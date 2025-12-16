#!/bin/bash

# Test script for the log server
# Make sure the server is running before executing this script

PORT=${1:-8080}
BASE_URL="http://localhost:${PORT}/log"

echo "Testing Log Server on port ${PORT}"
echo "======================================"
echo ""

# Test 1: JSON payload
echo "Test 1: Sending JSON payload..."
curl -X POST ${BASE_URL} \
  -H "Content-Type: application/json" \
  -d '{"event": "user_login", "user_id": 123, "timestamp": "2024-01-15T10:30:00Z", "ip": "192.168.1.1"}' \
  -w "\nStatus: %{http_code}\n\n"

sleep 1

# Test 2: Another JSON payload
echo "Test 2: Sending another JSON payload..."
curl -X POST ${BASE_URL} \
  -H "Content-Type: application/json" \
  -d '{"level": "error", "message": "Database connection failed", "retry_count": 3}' \
  -w "\nStatus: %{http_code}\n\n"

sleep 1

# Test 3: ND-JSON payload
echo "Test 3: Sending ND-JSON payload..."
curl -X POST ${BASE_URL} \
  -H "Content-Type: application/x-ndjson" \
  -d '{"event": "page_view", "page": "/home", "user": "alice"}
{"event": "click", "element": "signup_button", "user": "alice"}
{"event": "page_view", "page": "/pricing", "user": "alice"}' \
  -w "\nStatus: %{http_code}\n\n"

sleep 1

# Test 4: Plain string
echo "Test 4: Sending plain string..."
curl -X POST ${BASE_URL} \
  -H "Content-Type: text/plain" \
  -d 'This is a simple log message from the test script' \
  -w "\nStatus: %{http_code}\n\n"

sleep 1

# Test 5: Another plain string
echo "Test 5: Sending another plain string..."
curl -X POST ${BASE_URL} \
  -d 'Server started successfully at port 8080' \
  -w "\nStatus: %{http_code}\n\n"

sleep 1

# Test 6: Invalid JSON (should fail)
echo "Test 6: Sending invalid JSON (should return 400)..."
curl -X POST ${BASE_URL} \
  -H "Content-Type: application/json" \
  -d '{invalid json}' \
  -w "\nStatus: %{http_code}\n\n"

echo "======================================"
echo "Tests completed!"
echo "Check your log file to see the results"