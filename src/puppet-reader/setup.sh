#!/bin/bash

echo "🚀 Setting up Web Screenshot & OCR CLI Tool..."
echo ""

# Check for Bun, uncomment to allow for automatic installation.
if ! command -v bun &> /dev/null; then
    #echo "❌ Bun is not installed. Installing Bun..."
    echo "❌ Bun is not installed. Please install 🍞 Bun first."
    echo "   Install with: curl -fsSL https://bun.sh/install | bash 🍎(macOS) + 🐧(Ubuntu/Debian)"
    #echo "✅ Bun installed. Please restart your terminal and run this script again."
    exit 1
fi

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install 🐍 Python 3 first."
    exit 1
fi

# Check for ImageMagick
if ! command -v convert &> /dev/null; then
    echo "⚠️  ImageMagick is not installed. Some features may not work."
    echo "   Install with: sudo apt-get install imagemagick 🐧(Ubuntu/Debian)"
    echo "   or: brew install imagemagick 🍎(macOS)"
fi

# Check for Tesseract
if ! command -v tesseract &> /dev/null; then
    echo "⚠️  Tesseract OCR is not installed. OCR features will not work."
    echo "   Install with: sudo apt-get install tesseract-ocr 🐧(Ubuntu/Debian)"
    echo "   or: brew install tesseract 🍎(macOS)"
fi

echo ""
echo "📦 Installing Bun dependencies..."
bun install

echo ""
echo "🐍 Installing Python dependencies..."
pip3 install -r requirements.txt --break-system-packages 2>/dev/null || pip3 install -r requirements.txt --user

echo ""
echo "📁 Creating screenshots directory..."
mkdir -p screenshots

echo ""
echo "✨ Setup complete!"
echo ""
echo "📚 Usage examples:"
echo "  bun run index.ts --help"
echo "  bun run index.ts -u https://example.com"
echo "  bun run index.ts -c config.json"
echo ""