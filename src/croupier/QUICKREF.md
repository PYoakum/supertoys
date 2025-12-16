# Bun Static Server - Quick Reference

## Installation
```bash
curl -fsSL https://bun.sh/install | bash  # Install Bun
chmod +x setup.sh && ./setup.sh           # Run setup
```

## Basic Commands
```bash
bun run server.ts                    # Start server (port 3000)
bun run server.ts --help             # Show help
bun run server.ts -p 8080            # Custom port
bun run server.ts -d ./public        # Serve specific directory
```

## Common Flags
```
-p, --port <number>    Port (default: 3000)
-h, --host <string>    Host (default: localhost)
-d, --dir <path>       Directory to serve (default: .)
-i, --index <file>     Index file (default: index.html)
-c, --cache <seconds>  Cache duration (default: 3600)
-v, --verbose          Verbose logging
-l, --list             Directory listing
    --cors             Enable CORS
    --header <name:value>  Custom header
```

## Common Scenarios
```bash
# Development with CORS
bun run server.ts --cors -v

# Production
bun run server.ts -p 80 -h 0.0.0.0 -c 86400 --cors

# Media streaming
bun run server.ts -d ./videos -c 604800

# File browser
bun run server.ts -l -d ~/Documents

# No caching
bun run server.ts -c 0
```

## Custom Headers
```bash
# Security headers
bun run server.ts \
  --header "X-Frame-Options:DENY" \
  --header "X-Content-Type-Options:nosniff"

# Multiple headers
bun run server.ts \
  --header "X-Custom:Value1" \
  --header "X-Another:Value2"
```

## Range Request Testing
```bash
# cURL
curl -H "Range: bytes=0-100" http://localhost:3000/file.mp4

# JavaScript
fetch('http://localhost:3000/file.mp4', {
  headers: { 'Range': 'bytes=0-100' }
})
```

## Status Codes
- 200: OK (full file)
- 206: Partial Content (range)
- 403: Forbidden (directory)
- 404: Not Found
- 416: Range Not Satisfiable

## File Structure
```
bun-static-server/
├── server.ts        # Main server code
├── package.json     # Package configuration
├── README.md        # Full documentation
├── USAGE.md         # Detailed usage guide
├── test.ts          # Test suite
├── setup.sh         # Setup script
├── examples.sh      # Example configurations
├── index.html       # Demo page
└── .gitignore       # Git ignore rules
```

## Testing
```bash
# Start server
bun run server.ts --cors -l

# Run tests (in new terminal)
bun run test.ts
```

## Production Deployment
```bash
# Systemd service
sudo systemctl enable static-server
sudo systemctl start static-server

# Docker
docker build -t bun-static-server .
docker run -p 3000:3000 bun-static-server

# PM2
pm2 start "bun run server.ts -p 3000" --name static-server
```

## Troubleshooting
```bash
# Port in use
lsof -i :3000
bun run server.ts -p 8080

# Permission denied
sudo bun run server.ts -p 80

# Check logs
bun run server.ts -v
```

## Performance Tips
- ✅ Enable caching: `-c 86400`
- ✅ Use CDN (CloudFlare)
- ✅ Add reverse proxy (nginx)
- ✅ Compress assets
- ✅ Bind to all IPs: `-h 0.0.0.0`

## Links
- Bun: https://bun.sh
- Docs: See README.md
- Guide: See USAGE.md
