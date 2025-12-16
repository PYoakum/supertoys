#!/bin/bash

echo "🚀 Bun Static Server - Setup Script"
echo "===================================="
echo ""

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo "❌ Bun is not installed."
    echo "Please install Bun first: https://bun.sh"
    echo ""
    echo "Quick install:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo "✅ Bun detected: $(bun --version)"
echo ""

# Make server.ts executable
chmod +x server.ts
echo "✅ Made server.ts executable"

# Make examples.sh executable
chmod +x examples.sh
echo "✅ Made examples.sh executable"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Quick start commands:"
echo "  bun run server.ts              # Start with defaults"
echo "  bun run server.ts --help       # Show all options"
echo "  bun run server.ts --cors -l    # Enable CORS and directory listing"
echo ""
echo "The demo page (index.html) will be served automatically."
echo "Open http://localhost:3000 after starting the server."
echo ""
