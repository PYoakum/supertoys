# Example Server Configurations

## Development Server
# Serves current directory with verbose logging and CORS
bun run server.ts -d . -v --cors -l

## Production Server
# Serves production build with 1-day caching
bun run server.ts -d ./dist -p 8080 -h 0.0.0.0 -c 86400 --cors

## Video Streaming Server
# Optimized for video streaming with range requests
bun run server.ts -d ./media -c 604800 --header "X-Content-Type-Options:nosniff"

## API Mock Server
# Serves JSON files with CORS and custom headers
bun run server.ts -d ./mocks --cors \
  --header "X-API-Version:1.0" \
  --header "X-Rate-Limit:1000"

## Local File Browser
# Browse local files with directory listing
bun run server.ts -d ~/Downloads -l -c 0

## Secure Production Setup
# Production server with security headers
bun run server.ts -d /var/www/html -p 80 -h 0.0.0.0 -c 86400 \
  --header "X-Frame-Options:DENY" \
  --header "X-Content-Type-Options:nosniff" \
  --header "Strict-Transport-Security:max-age=31536000" \
  --header "Referrer-Policy:no-referrer" \
  --cors
