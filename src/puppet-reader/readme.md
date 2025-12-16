# Web Screenshot & OCR CLI Tool

A powerful CLI tool built with Bun that captures screenshots of web pages and extracts text using OCR. It integrates Python, OpenCV, Puppeteer, and ImageMagick for comprehensive web scraping and text extraction.

## Features

- 📸 **Screenshot Capture**: Takes full-page screenshots using Puppeteer
- 🔍 **OCR Text Extraction**: Extracts text from screenshots using OpenCV and Tesseract
- 🎨 **Image Preprocessing**: Enhances images with ImageMagick and OpenCV for better OCR results
- ⚙️ **Configurable**: Support for both CLI arguments and JSON config files
- ⏱️ **Customizable Wait Times**: Configure page load wait times
- 📦 **Batch Processing**: Process multiple URLs in a single run
- 💾 **Export Results**: Save extracted text to a file

## Prerequisites

Make sure you have the following installed:

### 1. Bun
```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Python 3
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install python3 python3-pip

# macOS
brew install python3
```

### 3. ImageMagick
```bash
# Ubuntu/Debian
sudo apt-get install imagemagick

# macOS
brew install imagemagick
```

### 4. Tesseract OCR
```bash
# Ubuntu/Debian
sudo apt-get install tesseract-ocr

# macOS
brew install tesseract
```

### 5. System Dependencies for OpenCV
```bash
# Ubuntu/Debian
sudo apt-get install libgl1-mesa-glx libglib2.0-0

# macOS (usually not needed)
```

## Installation

1. Clone or download this project:
```bash
cd web-screenshot-ocr-cli
```

2. Install Bun dependencies:
```bash
bun install
```

3. Install Python dependencies:
```bash
pip3 install -r requirements.txt --break-system-packages
```

4. Make the Python script executable (optional):
```bash
chmod +x ocr_processor.py
```

## Usage

### Command Line Arguments

```bash
# Process a single URL
bun run index.ts -u https://example.com -o results.txt

# Process multiple URLs
bun run index.ts -u https://example.com -u https://news.ycombinator.com -w 5000 -o results.txt

# Use a config file
bun run index.ts -c config.json
```

### CLI Options

- `-c, --config <path>` - Path to JSON config file
- `-u, --url <url>` - URL to process (can be used multiple times)
- `-w, --wait <ms>` - Wait time in milliseconds (default: 2000)
- `-o, --output <path>` - Output file path (default: output.txt)
- `-h, --help` - Show help message

### Configuration File

Create a `config.json` file:

```json
{
  "urls": [
    "https://example.com",
    "https://news.ycombinator.com"
  ],
  "waitTime": 3000,
  "outputFile": "output.txt",
  "screenshotDir": "./screenshots",
  "useOCR": true,
  "preprocessImage": true
}
```

**Configuration Options:**

- `urls` (array): List of URLs to process
- `waitTime` (number): Milliseconds to wait after page load (default: 2000)
- `outputFile` (string): Path to save extracted text (default: "output.txt")
- `screenshotDir` (string): Directory to save screenshots (default: "./screenshots")
- `useOCR` (boolean): Enable/disable OCR text extraction (default: true)
- `preprocessImage` (boolean): Enable/disable image preprocessing (default: true)

## Examples

### Example 1: Quick Screenshot and OCR
```bash
bun run index.ts -u https://example.com
```

### Example 2: Multiple URLs with Custom Wait Time
```bash
bun run index.ts \
  -u https://example.com \
  -u https://github.com \
  -w 5000 \
  -o github_content.txt
```

### Example 3: Using Config File
```bash
cp config.example.json config.json
# Edit config.json with your URLs
bun run index.ts -c config.json
```

### Example 4: Process News Sites
```bash
bun run index.ts \
  -u https://coolnews.tld \
  -u https://fakenews.tld \
  -w 4000 \
  -o tech_news.txt
```

## Architecture

The tool consists of two main components:

### 1. Bun/TypeScript Layer (`index.ts`)
- Handles CLI argument parsing
- Manages Puppeteer for browser automation
- Orchestrates the screenshot and OCR pipeline
- Calls ImageMagick for image preprocessing
- Spawns Python process for OCR
- Manages file I/O and result aggregation

### 2. Python Layer (`ocr_processor.py`)
- Uses OpenCV for advanced image preprocessing
- Applies denoising and adaptive thresholding
- Performs OCR using Tesseract via pytesseract
- Returns extracted text to parent process

## Output Format

The tool generates an output file with the following format:

```
================================================================================
URL: https://example.com
Timestamp: 2024-01-15T10:30:00.000Z
================================================================================
[Extracted text content here]

================================================================================
URL: https://another-site.com
Timestamp: 2024-01-15T10:30:15.000Z
================================================================================
[Extracted text content here]
```

## Troubleshooting

### Puppeteer Issues
If you encounter Puppeteer errors, try installing additional dependencies:
```bash
# Ubuntu/Debian
sudo apt-get install -y wget gnupg ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils
```

### OCR Quality Issues
- Increase `waitTime` to ensure page fully loads
- Enable `preprocessImage` in config for better text extraction
- Install additional Tesseract language packs if needed:
  ```bash
  sudo apt-get install tesseract-ocr-[lang]
  ```

### Permission Errors
If you get permission errors with Python packages:
```bash
pip3 install -r requirements.txt --user
```

## Development

To modify the tool:

1. Edit `index.ts` for Bun/TypeScript functionality
2. Edit `ocr_processor.py` for OCR and image processing
3. Run without build step (Bun executes TypeScript directly):
   ```bash
   bun run index.ts
   ```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.