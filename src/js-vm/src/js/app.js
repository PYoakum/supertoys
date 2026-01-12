"use strict";

window.onload = function()
{
    // Async loading of the iso image
    // Note how the emulation starts without downloading the 50MB image

    // Support of the "Range: bytes=..." header is required on the server, CORS
    // is required if the server is on a different host

    var emulator = new V86({
        wasm_path: "./v86.wasm",
        memory_size: 256 * 1024 * 1024,           // 256MB RAM (adjust as needed)
        vga_memory_size: 8 * 1024 * 1024,
        screen_container: document.getElementById("screen_container"),
        bios: {
            url: "./seabios.bin",
        },
        vga_bios: {
            url: "./vgabios.bin",
        },
        cdrom: {
            url: "./tiny-core.iso",
            async: true,
        },
        boot_order: 0x123,  
        autostart: true,
    });
}