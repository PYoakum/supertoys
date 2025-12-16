#!/bin/bash

# Certificate generation script for mTLS proxy
# This script generates a complete certificate chain for testing

set -e

CERT_DIR="./certs"
DAYS_VALID=365

echo "======================================"
echo "mTLS Proxy Certificate Generator"
echo "======================================"
echo ""

# Create certificate directory
mkdir -p "$CERT_DIR"

echo "Step 1: Generating Certificate Authority (CA)"
echo "----------------------------------------------"
openssl req -x509 -newkey rsa:4096 -keyout "$CERT_DIR/ca-key.pem" \
  -out "$CERT_DIR/ca-cert.pem" -days $DAYS_VALID -nodes \
  -subj "/C=US/ST=California/L=San Francisco/O=Test Organization/CN=Test CA" 2>/dev/null

echo "✓ CA certificate generated"
echo "  - Certificate: $CERT_DIR/ca-cert.pem"
echo "  - Private Key: $CERT_DIR/ca-key.pem"
echo ""

echo "Step 2: Generating Server Certificate"
echo "--------------------------------------"

# Generate server private key
openssl genrsa -out "$CERT_DIR/server-key.pem" 4096 2>/dev/null

# Create server certificate config with SAN
cat > "$CERT_DIR/server.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = California
L = San Francisco
O = Test Organization
CN = localhost

[v3_req]
keyUsage = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

# Generate server CSR with config
openssl req -new -key "$CERT_DIR/server-key.pem" \
  -out "$CERT_DIR/server-csr.pem" \
  -config "$CERT_DIR/server.cnf" 2>/dev/null

# Sign server certificate with CA
openssl x509 -req -in "$CERT_DIR/server-csr.pem" \
  -CA "$CERT_DIR/ca-cert.pem" -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERT_DIR/server-cert.pem" \
  -days $DAYS_VALID \
  -extensions v3_req \
  -extfile "$CERT_DIR/server.cnf" 2>/dev/null

echo "✓ Server certificate generated"
echo "  - Certificate: $CERT_DIR/server-cert.pem"
echo "  - Private Key: $CERT_DIR/server-key.pem"
echo ""

echo "Step 3: Generating Client Certificate"
echo "--------------------------------------"

# Generate client private key
openssl genrsa -out "$CERT_DIR/client-key.pem" 4096 2>/dev/null

# Create client certificate config
cat > "$CERT_DIR/client.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = California
L = San Francisco
O = Test Organization
CN = Test Client

[v3_req]
keyUsage = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = clientAuth
EOF

# Generate client CSR with config
openssl req -new -key "$CERT_DIR/client-key.pem" \
  -out "$CERT_DIR/client-csr.pem" \
  -config "$CERT_DIR/client.cnf" 2>/dev/null

# Sign client certificate with CA
openssl x509 -req -in "$CERT_DIR/client-csr.pem" \
  -CA "$CERT_DIR/ca-cert.pem" -CAkey "$CERT_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERT_DIR/client-cert.pem" \
  -days $DAYS_VALID \
  -extensions v3_req \
  -extfile "$CERT_DIR/client.cnf" 2>/dev/null

echo "✓ Client certificate generated"
echo "  - Certificate: $CERT_DIR/client-cert.pem"
echo "  - Private Key: $CERT_DIR/client-key.pem"
echo ""

# Set proper permissions
chmod 600 "$CERT_DIR"/*-key.pem
chmod 644 "$CERT_DIR"/*-cert.pem

echo "Step 4: Verification"
echo "--------------------"

# Verify certificates
echo "Verifying server certificate..."
openssl verify -CAfile "$CERT_DIR/ca-cert.pem" "$CERT_DIR/server-cert.pem"

echo "Verifying client certificate..."
openssl verify -CAfile "$CERT_DIR/ca-cert.pem" "$CERT_DIR/client-cert.pem"

echo ""
echo "======================================"
echo "✓ All certificates generated successfully!"
echo "======================================"
echo ""
echo "Certificate Summary:"
echo "-------------------"
echo "CA Certificate:     $CERT_DIR/ca-cert.pem"
echo "Server Certificate: $CERT_DIR/server-cert.pem"
echo "Server Key:         $CERT_DIR/server-key.pem"
echo "Client Certificate: $CERT_DIR/client-cert.pem"
echo "Client Key:         $CERT_DIR/client-key.pem"
echo ""
echo "Valid for: $DAYS_VALID days"
echo ""
echo "To view certificate details:"
echo "  openssl x509 -in $CERT_DIR/server-cert.pem -text -noout"
echo ""
echo "To start the proxy:"
echo "  ./target/release/mtls-proxy \\"
echo "    --listen 127.0.0.1:8443 \\"
echo "    --upstream http://localhost:8080 \\"
echo "    --server-cert $CERT_DIR/server-cert.pem \\"
echo "    --server-key $CERT_DIR/server-key.pem \\"
echo "    --client-ca $CERT_DIR/ca-cert.pem"
echo ""
echo "To test with curl:"
echo "  curl --cacert $CERT_DIR/ca-cert.pem \\"
echo "    --cert $CERT_DIR/client-cert.pem \\"
echo "    --key $CERT_DIR/client-key.pem \\"
echo "    https://localhost:8443/"