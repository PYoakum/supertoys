export async function serveFile(filePath, request) {
  try {
    const file = Bun.file(filePath);
    const fileSize = file.size;

    // Get the Range header if present
    const rangeHeader = request.headers.get("range");

    // No range header - serve the entire file
    if (!rangeHeader) {
      return new Response(file, {
        status: 200,
        headers: {
          "content-type": file.type,
          "content-length": fileSize.toString(),
          "accept-ranges": "bytes",
        },
      });
    }

    // Parse the range header (e.g., "bytes=0-1023" or "bytes=1024-")
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!rangeMatch) {
      return new Response("Invalid range header", { status: 416 });
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

    // Validate range
    if (start > end || start < 0 || end >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${fileSize}`,
        },
      });
    }

    const length = end - start + 1;

    // Slice the file for the requested range
    const slicedFile = file.slice(start, end + 1);

    return new Response(slicedFile, {
      status: 206,
      headers: {
        "content-type": file.type,
        "content-length": length.toString(),
        "content-range": `bytes ${start}-${end}/${fileSize}`,
        "accept-ranges": "bytes",
      },
    });
  } catch (error) {
    return new Response("File not found", { status: 404 });
  }
}
