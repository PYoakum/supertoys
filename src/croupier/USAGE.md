# Bun Static Server - Usage Guide

## Table of Contents
1. [Quick Start](#quick-start)
2. [Common Scenarios](#common-scenarios)
3. [Range Request Examples](#range-request-examples)
4. [Custom Headers](#custom-headers)
5. [Production Deployment](#production-deployment)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Installation
```bash
# Ensure Bun is installed
curl -fsSL https://bun.sh/install | bash

# Navigate to project directory
cd bun-static-server

# Run setup script
chmod +x setup.sh
./setup.sh

# Start the server
bun run server.ts
```

### First Run
```bash
# Serve current directory on default port (3000)
bun run server.ts

# Open browser to http://localhost:3000
```

---

## Common Scenarios

### 1. Development Server for React/Vue/Angular

Serve your build output with CORS and verbose logging:

```bash
# After building your app
bun run server.ts -d ./dist --cors -v

# Or for Create React App
bun run server.ts -d ./build --cors -v
```

### 2. Video/Audio Streaming Server

Optimize for media files with long caching and range support:

```bash
# Serve media directory
bun run server.ts -d ./media -c 604800 -p 8080

# Cache for 7 days (604800 seconds)
# Range requests are always enabled
```

### 3. Local File Browser

Browse and preview local files:

```bash
# Enable directory listing for any folder
bun run server.ts -d ~/Documents -l -c 0

# Navigate to http://localhost:3000 to browse
```

### 4. API Mock Server

Serve JSON files for frontend development:

```bash
# Serve mock data with CORS
bun run server.ts -d ./api-mocks --cors \
  --header "X-API-Version:1.0" \
  --header "Content-Type:application/json"
```

### 5. Static Site Hosting

Host a static website with production settings:

```bash
# Production configuration
bun run server.ts -d /var/www/html \
  -p 80 \
  -h 0.0.0.0 \
  -c 86400 \
  --cors \
  --header "X-Frame-Options:SAMEORIGIN" \
  --header "X-Content-Type-Options:nosniff"
```

---

## Range Request Examples

### Understanding Range Requests

Range requests allow clients to request specific byte ranges of a file, enabling:
- Video/audio seeking
- Download resumption
- Bandwidth optimization

### Testing with cURL

```bash
# Request first 1KB
curl -H "Range: bytes=0-1023" http://localhost:3000/video.mp4

# Request from byte 1000 to end
curl -H "Range: bytes=1000-" http://localhost:3000/large-file.zip

# Request specific range (bytes 1000-2000)
curl -H "Range: bytes=1000-2000" http://localhost:3000/file.pdf
```

### Testing with JavaScript

```javascript
// Full request
fetch('http://localhost:3000/video.mp4')
  .then(r => console.log('Status:', r.status)); // 200

// Range request
fetch('http://localhost:3000/video.mp4', {
  headers: { 'Range': 'bytes=0-1000' }
}).then(r => {
  console.log('Status:', r.status); // 206
  console.log('Range:', r.headers.get('Content-Range'));
});
```

### HTML5 Video Player

The server's range request support enables HTML5 video seeking:

```html
<video controls width="640">
  <source src="http://localhost:3000/video.mp4" type="video/mp4">
</video>
```

---

## Custom Headers

### Security Headers

```bash
bun run server.ts \
  --header "X-Frame-Options:DENY" \
  --header "X-Content-Type-Options:nosniff" \
  --header "X-XSS-Protection:1; mode=block" \
  --header "Referrer-Policy:no-referrer" \
  --header "Permissions-Policy:geolocation=(), microphone=(), camera=()"
```

### Custom Application Headers

```bash
bun run server.ts \
  --header "X-Powered-By:Bun" \
  --header "X-API-Version:2.0" \
  --header "X-Environment:production"
```

### Content Security Policy

```bash
bun run server.ts \
  --header "Content-Security-Policy:default-src 'self'; script-src 'self' 'unsafe-inline'"
```

---

## Production Deployment

### Basic Production Setup

```bash
# Create a systemd service file
sudo nano /etc/systemd/system/static-server.service
```

```ini
[Unit]
Description=Bun Static Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/static-server
ExecStart=/usr/local/bin/bun run server.ts -d /var/www/html -p 80 -h 0.0.0.0 -c 86400 --cors
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable static-server
sudo systemctl start static-server
sudo systemctl status static-server
```

### With Reverse Proxy (nginx)

Recommended for production with SSL and compression:

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # Enable gzip compression
        gzip on;
        gzip_types text/plain text/css application/json application/javascript;
    }
}
```

### Docker Deployment

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json ./
COPY server.ts ./
COPY public ./public

EXPOSE 3000

CMD ["bun", "run", "server.ts", "-d", "./public", "-h", "0.0.0.0"]
```

```bash
# Build and run
docker build -t bun-static-server .
docker run -p 3000:3000 -v $(pwd)/public:/app/public bun-static-server
```

---

## Troubleshooting

### Server Won't Start

**Problem**: Port already in use
```bash
# Check what's using the port
lsof -i :3000

# Use a different port
bun run server.ts -p 8080
```

**Problem**: Permission denied (port < 1024)
```bash
# Use sudo for privileged ports
sudo bun run server.ts -p 80

# Or use port >= 1024
bun run server.ts -p 8080
```

### CORS Issues

**Problem**: Cross-origin request blocked
```bash
# Enable CORS
bun run server.ts --cors
```

**Problem**: Need specific origin
```javascript
// Modify server.ts to add specific origin
headers["Access-Control-Allow-Origin"] = "https://yourdomain.com";
```

### Range Requests Not Working

**Problem**: 416 Range Not Satisfiable
```bash
# Check file size first
curl -I http://localhost:3000/file.mp4

# Then request valid range
curl -H "Range: bytes=0-1000" http://localhost:3000/file.mp4
```

### Performance Issues

**Problem**: Slow response times
```bash
# Check verbose logs
bun run server.ts -v

# Monitor server resources
htop
```

**Solutions**:
- Enable caching: `-c 86400`
- Use a CDN for static assets
- Add a reverse proxy (nginx) with gzip
- Optimize file sizes

### Directory Listing Not Showing

**Problem**: Getting 403 Forbidden
```bash
# Enable directory listing
bun run server.ts -l
```

### Files Not Found

**Problem**: 404 errors for existing files
```bash
# Check directory path
bun run server.ts -d /absolute/path/to/files -v

# Verify file permissions
ls -la /path/to/files
```

---

## Performance Tips

1. **Enable Caching**: Set appropriate cache headers
   ```bash
   bun run server.ts -c 86400  # 24 hours
   ```

2. **Use CDN**: Put CloudFlare or similar in front

3. **Compression**: Use nginx reverse proxy for gzip/brotli

4. **Optimize Assets**: 
   - Minify JS/CSS
   - Compress images
   - Use modern formats (WebP, AVIF)

5. **Network Configuration**:
   ```bash
   # Bind to all interfaces for external access
   bun run server.ts -h 0.0.0.0
   ```

---

## Advanced Configuration

### Environment Variables

Create a `.env` file:
```bash
PORT=3000
HOST=0.0.0.0
SERVE_DIR=./public
CACHE_SECONDS=86400
```

Then modify server.ts to read from env:
```typescript
const port = parseInt(process.env.PORT || "3000");
```

### Custom MIME Types

Edit `MIME_TYPES` in server.ts:
```typescript
const MIME_TYPES: Record<string, string> = {
  // Add your custom types
  ".myext": "application/x-mytype",
  ...
};
```

---

## Testing Your Setup

Run the included test suite:
```bash
# Start server in one terminal
bun run server.ts --cors -l

# Run tests in another terminal
bun run test.ts
```

Expected output:
- ✅ All range requests return 206
- ✅ Full requests return 200
- ✅ Invalid requests handled properly

---

## Additional Resources

- [Bun Documentation](https://bun.sh/docs)
- [HTTP Range Requests (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests)
- [HTTP Status Codes](https://httpstatuses.com/)
- [CORS Documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

## Contributing

Found a bug or want to contribute? Please submit issues or pull requests!

## License

MIT License - Feel free to use in your projects!
