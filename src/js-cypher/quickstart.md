# Quick Start Guide

## Installation

1. **Install Bun** (if not already installed):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Make the script executable**:
   ```bash
   chmod +x encode-cli.ts
   ```

3. **Optional: Install globally**:
   ```bash
   bun link
   ```
   Then you can use it from anywhere as `encode-cli`

## Quick Examples

### Encoding
```bash
# Base64 encode
bun encode-cli.ts -a base64 -o encode -i "Hello World"

# SHA-256 hash
bun encode-cli.ts -a sha256 -o encode -i "password"

# Hex encode
bun encode-cli.ts -a hex -o encode -i "data"
```

### Decoding
```bash
# Base64 decode
bun encode-cli.ts -a base64 -o decode -i "SGVsbG8gV29ybGQ="

# Hex decode
bun encode-cli.ts -a hex -o decode -i "48656c6c6f"
```

### File Operations
```bash
# Encode file to base64
bun encode-cli.ts -a base64 -o encode -f input.txt -w output.b64

# Decode file from base64
bun encode-cli.ts -a base64 -o decode -f output.b64 -w decoded.txt

# Hash a file
bun encode-cli.ts -a sha256 -o encode -f document.pdf
```

### HMAC (with secret key)
```bash
# HMAC-SHA256
bun encode-cli.ts -a hmac-sha256 -o encode -i "message" -k "secret_key"

# HMAC file
bun encode-cli.ts -a hmac-sha512 -o encode -f data.json -k "my-secret"
```

## Running Tests

Run the test script to see all features in action:
```bash
bash test-examples.sh
```

## Common Use Cases

1. **API Token Generation**
   ```bash
   bun encode-cli.ts -a base64 -o encode -i "username:password"
   ```

2. **Password Hashing**
   ```bash
   bun encode-cli.ts -a sha256 -o encode -i "user_password"
   ```

3. **File Checksum**
   ```bash
   bun encode-cli.ts -a sha256 -o encode -f myfile.zip
   ```

4. **Webhook Signature**
   ```bash
   bun encode-cli.ts -a hmac-sha256 -o encode -f payload.json -k "webhook_secret"
   ```

For complete documentation, see README.md