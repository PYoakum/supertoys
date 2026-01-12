# V86 Virtual Machine Emulator

A single-page application built with Bun that provides a web interface for running x86 virtual machines using the v86 emulator. Features include multiple VM configurations, terminal access, and WebSocket-based networking.

## Features

- 🖥️ **Multiple VM Support**: Switch between different operating systems via dropdown or URL parameters
- 🔌 **Network Simulation**: WebSocket-based networking between VM instances
- 💻 **Terminal Interface**: Interactive terminal using xterm.js
- 📺 **Graphical Display**: VGA screen output for graphical operating systems
- ⚙️ **Configurable**: Easy VM configuration through JSON manifest
- 🚀 **Fast**: Built on Bun runtime for optimal performance

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- Modern web browser with WebSocket support

## Installation

1. Install Bun (if not already installed):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. No additional dependencies needed! All libraries are loaded via CDN.

## Usage

### Starting the Server

```bash
bun run server.js
```

Or use the npm script:

```bash
bun start
```

The server will start on `http://localhost:3000`

### Accessing VMs

**Default access:**
```
http://localhost:3000
```

**Select specific VM via URL parameter:**
```
http://localhost:3000/?vm=linux
http://localhost:3000/?vm=freedos
http://localhost:3000/?vm=windows1
http://localhost:3000/?vm=kolibrios
```

### Using the Interface

1. **Select a VM**: Choose from the dropdown menu or use URL parameters
2. **Start VM**: Click the "Start VM" button
3. **Interact**: Use the terminal or screen to interact with the VM
4. **Stop VM**: Click "Stop VM" when done

## API Endpoints

### GET /api/manifest
Returns the complete VM manifest with all available configurations.

**Example:**
```bash
curl http://localhost:3000/api/manifest
```

### GET /api/vm?id={vm_id}
Returns configuration for a specific VM.

**Example:**
```bash
curl http://localhost:3000/api/vm?id=linux
```

### WebSocket /ws?vm={vm_id}
WebSocket endpoint for VM network connectivity.

**Example:**
```javascript
const ws = new WebSocket('ws://localhost:3000/ws?vm=linux');
```

## Configuration

### Adding Custom VMs

Edit `manifest.json` to add new VM configurations:

```json
{
  "vms": {
    "my_custom_vm": {
      "name": "My Custom VM",
      "description": "Description of my VM",
      "memory_size": 134217728,
      "vga_memory_size": 8388608,
      "bios": "https://path/to/bios.bin",
      "vga_bios": "https://path/to/vgabios.bin",
      "cdrom": "https://path/to/disk.iso",
      "hda": "https://path/to/harddisk.img",
      "fda": "https://path/to/floppy.img"
    }
  }
}
```

### Configuration Options

- `name`: Display name for the VM
- `description`: Brief description
- `memory_size`: RAM in bytes (default: 128MB)
- `vga_memory_size`: Video memory in bytes (default: 8MB)
- `bios`: URL to BIOS file
- `vga_bios`: URL to VGA BIOS file
- `cdrom`: URL to CD-ROM image (ISO)
- `hda`: URL to hard disk image
- `fda`: URL to floppy disk image

## Pre-configured VMs

### Linux (Arch Linux)
Lightweight Arch Linux distribution
- Memory: 128MB
- Boot: CD-ROM

### FreeDOS
Classic DOS operating system
- Memory: 32MB
- Boot: Floppy disk

### Windows 1.01
Historic Windows 1.01 from 1985
- Memory: 16MB
- Boot: Floppy disk

### KolibriOS
Lightweight, fast operating system
- Memory: 32MB
- Boot: Floppy disk

## Network Simulation

The application includes WebSocket-based networking:

1. Each VM connects to `/ws?vm={vm_id}`
2. Multiple instances of the same VM can communicate
3. Data is relayed through the WebSocket server
4. Simulates basic network connectivity

## Project Structure

```
.
├── server.js           # Bun server with WebSocket support
├── index.html          # Single page application
├── manifest.json       # VM configuration manifest
├── package.json        # Project metadata
└── README.md          # This file
```

## Technical Details

### Stack
- **Runtime**: Bun
- **Emulator**: v86 (x86 emulation in JavaScript)
- **Terminal**: xterm.js (modern term.js replacement)
- **Networking**: WebSocket API
- **Frontend**: Vanilla JavaScript

### Browser Compatibility
- Chrome/Edge: ✅
- Firefox: ✅
- Safari: ✅
- Opera: ✅

## Troubleshooting

### VM won't start
- Check browser console for errors
- Verify image URLs in manifest.json are accessible
- Ensure sufficient memory allocation

### Terminal not responding
- Check WebSocket connection status
- Verify serial output is being captured
- Try refreshing the page

### Network issues
- Verify WebSocket connection in browser DevTools
- Check firewall settings
- Ensure port 3000 is accessible

## Development

### Watch mode
Run server with auto-reload on file changes:
```bash
bun --watch server.js
```

## License

MIT

## Credits

- [v86](https://github.com/copy/v86) - x86 virtualization in JavaScript
- [xterm.js](https://xtermjs.org/) - Terminal emulator for the web
- [Bun](https://bun.sh) - Fast JavaScript runtime

## Contributing

Feel free to submit issues and enhancement requests!
