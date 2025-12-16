# Bun Static Server

A blazing-fast static file server built for the Bun runtime with full support for range requests, partial responses, and configurable headers.

## Features

✨ **Fast & Lightweight** - Built on Bun's native HTTP server for maximum performance  
📦 **Range Requests** - Full HTTP 206 partial content support for video/audio streaming  
🎨 **Configurable Headers** - Add custom headers via CLI flags  
🌐 **CORS Support** - Enable cross-origin requests with a single flag  
📁 **Directory Listing** - Optional directory browsing interface  
🔒 **Security** - Built-in path traversal protection  
💾 **Cache Control** - Configurable caching headers  
🎯 **MIME Types** - Automatic content-type detection for common file types

## Installation

### Prerequisites
- [Bun](https://bun.sh) 1.0.0 or higher

### Quick Start

```bash
# Clone or download the files
cd bun-static-server

# Make the script executable (optional)
chmod +x server.ts

# Run the server
bun run server.ts
```

### Global Installation (Optional)

```bash
# Install globally
bun link

# Run from anywhere
bun-static-server --help
```

## Usage

### Basic Usage

```bash
# Serve current directory on default port 3000
bun run server.ts

# Serve specific directory
bun run server.ts -d ./public

# Custom port and host
bun run server.ts -p 8080 -h 0.0.0.0
```

### Advanced Examples

```bash
# Enable CORS and directory listing
bun run server.ts --cors -l -d ./assets

# Add custom headers
bun run server.ts --header "X-Custom-Header:Value" --header "X-Another:Test"

# Verbose logging
bun run server.ts -v -d ./dist

# Disable caching
bun run server.ts -c 0

# Production setup
bun run server.ts -p 80 -h 0.0.0.0 -d /var/www/html --cors -c 86400
```

## CLI Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--port` | `-p` | 3000 | Port to listen on |
| `--host` | `-h` | localhost | Host to bind to |
| `--dir` | `-d` | `.` | Directory to serve files from |
| `--index` | `-i` | index.html | Index file name |
| `--cache` | `-c` | 3600 | Cache-Control max-age in seconds |
| `--cors` | | false | Enable CORS headers |
| `--header` | | | Add custom header (repeatable) |
| `--verbose` | `-v` | false | Enable verbose logging |
| `--list` | `-l` | false | Enable directory listing |
| `--help` | | | Show help message |

## Range Request Support

The server fully supports HTTP range requests (RFC 7233), enabling:

- **Video/Audio Streaming** - Seek to any position without downloading entire file
- **Resume Downloads** - Continue interrupted downloads
- **Partial Content Delivery** - Save bandwidth by requesting only needed bytes

### Example Range Request

```bash
# Request bytes 0-1023 (first 1KB)
curl -H "Range: bytes=0-1023" http://localhost:3000/video.mp4

# Request from byte 1000 to end of file
curl -H "Range: bytes=1000-" http://localhost:3000/large-file.zip
```

### Response Headers

The server responds with:
- **Status 206** - Partial Content
- **Content-Range** - Specifies which bytes are being returned
- **Accept-Ranges** - Indicates range support
- **Content-Length** - Size of the partial content

## Custom Headers

Add custom headers to all responses:

```bash
# Single header
bun run server.ts --header "X-Powered-By:Bun"

# Multiple headers
bun run server.ts \
  --header "X-Frame-Options:DENY" \
  --header "X-Content-Type-Options:nosniff" \
  --header "Strict-Transport-Security:max-age=31536000"
```

## CORS Configuration

Enable CORS for cross-origin requests:

```bash
bun run server.ts --cors
```

This adds the following headers:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: Range`

## Directory Listing

Enable browsable directory listings:

```bash
bun run server.ts -l -d ./public
```

Features:
- Clean, modern interface
- File size display
- Folder icons
- Parent directory navigation
- Sorted (folders first, then alphabetical)

## Cache Control

Configure cache headers for better performance:

```bash
# Cache for 1 hour (default)
bun run server.ts -c 3600

# Cache for 1 day
bun run server.ts -c 86400

# Disable caching
bun run server.ts -c 0
```

## MIME Types

Automatic content-type detection for:

**Web**: HTML, CSS, JavaScript, JSON, XML  
**Images**: PNG, JPG, GIF, SVG, WebP, ICO  
**Video**: MP4, WebM  
**Audio**: MP3, WAV  
**Fonts**: WOFF, WOFF2, TTF, EOT  
**Documents**: PDF, TXT, ZIP

Unrecognized files default to `application/octet-stream`.

## Security

Built-in security features:

- **Path Traversal Protection** - Blocks `..` in URLs
- **Method Filtering** - Only allows GET, HEAD, OPTIONS
- **No Directory Exposure** - Directories return 403 unless listing enabled
- **MIME Type Validation** - Proper content-type headers prevent MIME confusion

## Performance Tips

1. **Use CDN** - For production, put a CDN in front
2. **Enable Caching** - Set appropriate cache headers
3. **Bind to 0.0.0.0** - For network access: `-h 0.0.0.0`
4. **Disable Verbose** - Turn off `-v` in production
5. **Compression** - Use a reverse proxy (nginx) for gzip/brotli

## Example Use Cases

### Development Server
```bash
# Serve React/Vue build output
bun run server.ts -d ./dist --cors -v
```

### Video Streaming Server
```bash
# Serve video files with range support
bun run server.ts -d ./videos -c 86400
```

### API Mock Server
```bash
# Serve JSON files with CORS
bun run server.ts -d ./api-mocks --cors --header "X-API-Version:1.0"
```

### Local File Browser
```bash
# Browse files with directory listing
bun run server.ts -l -d ~/Documents
```

## npm Scripts

Convenience scripts defined in `package.json`:

```bash
bun start          # Start server with defaults
bun dev            # Start with verbose logging
bun serve          # Serve ./public directory
bun serve:cors     # Serve with CORS and listing enabled
```

## Troubleshooting

### Port Already in Use
```bash
# Try a different port
bun run server.ts -p 8080
```

### Permission Denied (Port < 1024)
```bash
# Use sudo for privileged ports
sudo bun run server.ts -p 80
```

### CORS Errors
```bash
# Enable CORS
bun run server.ts --cors
```

### Directory Not Accessible
```bash
# Check directory exists and has read permissions
ls -la /path/to/directory
```

## Technical Details

### HTTP Status Codes
- **200** - OK (full file)
- **206** - Partial Content (range request)
- **204** - No Content (OPTIONS preflight)
- **403** - Forbidden (directory without listing)
- **404** - Not Found
- **405** - Method Not Allowed
- **416** - Range Not Satisfiable

### Response Headers
```
Content-Type: application/octet-stream
Accept-Ranges: bytes
Last-Modified: Wed, 08 Dec 2025 12:00:00 GMT
Cache-Control: public, max-age=3600
Content-Length: 12345
[Custom headers...]
```

### Range Response Headers
```
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/5000
Content-Length: 1024
Accept-Ranges: bytes
```

## License

MIT

## Contributing

Contributions welcome! Feel free to submit issues or pull requests.

## Changelog

### v1.0.0
- Initial release
- Range request support
- Configurable headers
- CORS support
- Directory listing
- Cache control
- Verbose logging
