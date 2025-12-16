#!/bin/bash

# KV Store API Testing Script
# Make sure the server is running before executing this script

BASE_URL="http://localhost:3000"

echo "🧪 Testing KV Store API"
echo "======================="
echo ""

# Health Check
echo "1️⃣  Health Check"
curl -s $BASE_URL/health | jq
echo -e "\n"

# Get initial stats
echo "2️⃣  Initial Statistics"
curl -s $BASE_URL/stats | jq
echo -e "\n"

# Create some keys
echo "3️⃣  Creating keys"
echo "Creating user:101..."
curl -s -X POST $BASE_URL/keys/user:101 \
  -H "Content-Type: application/json" \
  -d '{"value":"Alice Anderson"}' | jq
echo ""

echo "Creating user:102..."
curl -s -X POST $BASE_URL/keys/user:102 \
  -H "Content-Type: application/json" \
  -d '{"value":"Bob Brown"}' | jq
echo -e "\n"

# List all keys
echo "4️⃣  Listing all keys"
curl -s $BASE_URL/keys | jq
echo -e "\n"

# Get a specific key
echo "5️⃣  Getting user:101"
curl -s $BASE_URL/keys/user:101 | jq
echo -e "\n"

# Update a key
echo "6️⃣  Updating user:101"
curl -s -X PUT $BASE_URL/keys/user:101 \
  -H "Content-Type: application/json" \
  -d '{"value":"Alice Anderson-Smith"}' | jq
echo -e "\n"

# Verify the update
echo "7️⃣  Verifying update"
curl -s $BASE_URL/keys/user:101 | jq
echo -e "\n"

# Bulk insert
echo "8️⃣  Bulk insert"
curl -s -X POST $BASE_URL/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "product:1": "Laptop",
      "product:2": "Mouse",
      "product:3": "Keyboard",
      "price:1": "999.99",
      "price:2": "29.99",
      "price:3": "79.99"
    }
  }' | jq
echo -e "\n"

# Get all key-value pairs
echo "9️⃣  Getting all key-value pairs"
curl -s $BASE_URL/all | jq
echo -e "\n"

# Get updated stats
echo "🔟 Updated Statistics"
curl -s $BASE_URL/stats | jq
echo -e "\n"

# Delete a key
echo "1️⃣1️⃣  Deleting user:102"
curl -s -X DELETE $BASE_URL/keys/user:102 | jq
echo -e "\n"

# Try to get deleted key (should fail)
echo "1️⃣2️⃣  Trying to get deleted key (should fail)"
curl -s $BASE_URL/keys/user:102 | jq
echo -e "\n"

# Final stats
echo "1️⃣3️⃣  Final Statistics"
curl -s $BASE_URL/stats | jq
echo -e "\n"

echo "✅ Test suite completed!"