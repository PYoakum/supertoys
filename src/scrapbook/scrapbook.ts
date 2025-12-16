#!/usr/bin/env bun

/*
*
* scrapbook 
* photo formatting tool
*
*/

import { parseArgs } from "util";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { basename, extname, join } from "path";

interface ImageOperation {
  type: "crop" | "rotate" | "scale" | "skew" | "watermark";
  params: any;
}

interface CLIOptions {
  input: string;
  output?: string;
  operations: ImageOperation[];
}

// Color codes for pretty output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function showHelp() {
  console.log(`
${colors.bright}${colors.cyan}Image Manipulation CLI Tool${colors.reset}
${colors.blue}${"=".repeat(50)}${colors.reset}

${colors.bright}Usage:${colors.reset}
  bun run index.ts -i <input> [options]

${colors.bright}Required:${colors.reset}
  -i, --input <path>        Input image path

${colors.bright}Optional:${colors.reset}
  -o, --output <path>       Output image path (default: <input>_modified.<ext>)
  -h, --help                Show this help message

${colors.bright}Operations:${colors.reset}

${colors.green}Crop:${colors.reset}
  --crop <WxH+X+Y>          Crop image (e.g., 800x600+100+50)
                            W=width, H=height, X=x-offset, Y=y-offset
  --crop-center <WxH>       Crop from center (e.g., 800x600)
  --crop-square             Crop to largest centered square

${colors.green}Rotate:${colors.reset}
  --rotate <degrees>        Rotate image (e.g., 90, -45, 180)
  --rotate-right            Rotate 90 degrees clockwise
  --rotate-left             Rotate 90 degrees counter-clockwise
  --flip-horizontal         Flip image horizontally
  --flip-vertical           Flip image vertically

${colors.green}Scale:${colors.reset}
  --scale <WxH>             Scale to exact dimensions (e.g., 1920x1080)
  --scale-width <W>         Scale to width, maintain aspect ratio
  --scale-height <H>        Scale to height, maintain aspect ratio
  --scale-percent <N>       Scale by percentage (e.g., 50, 150)
  --thumbnail <size>        Create thumbnail (e.g., 200x200)

${colors.green}Skew:${colors.reset}
  --skew <XxY>              Skew image (e.g., 20x0, 0x15, 10x5)

${colors.green}Watermark:${colors.reset}
  --watermark <path>        Watermark image path
  --watermark-text <text>   Text watermark
  --watermark-position <P>  Position: NorthWest, North, NorthEast, West,
                            Center, East, SouthWest, South, SouthEast
                            (default: SouthEast)
  --watermark-opacity <N>   Opacity 0-100 (default: 50)
  --watermark-size <N>      Font size for text watermark (default: 32)

${colors.bright}Effects:${colors.reset}
  --blur <radius>           Apply blur (e.g., 0x8)
  --sharpen <radius>        Apply sharpen (e.g., 0x1)
  --grayscale               Convert to grayscale
  --sepia                   Apply sepia tone
  --negate                  Invert colors
  --border <WxH>            Add border (e.g., 10x10)
  --border-color <color>    Border color (default: black)

${colors.bright}Format:${colors.reset}
  --format <fmt>            Output format (jpg, png, gif, webp, bmp, tiff)
  --quality <N>             JPEG quality 1-100 (default: 85)

${colors.bright}Examples:${colors.reset}

  # Crop and rotate
  bun run index.ts -i photo.jpg --crop 800x600+100+50 --rotate 90

  # Create thumbnail with watermark
  bun run index.ts -i image.png --thumbnail 300x300 \\
    --watermark-text "© 2024" --watermark-position SouthEast

  # Scale and add effects
  bun run index.ts -i photo.jpg --scale-width 1920 --blur 0x5 \\
    --output blurred.jpg

  # Multiple operations in sequence
  bun run index.ts -i photo.jpg \\
    --crop-square \\
    --scale 800x800 \\
    --rotate 45 \\
    --watermark logo.png \\
    --watermark-opacity 30 \\
    --format png

  # Create sepia-toned thumbnail with border
  bun run index.ts -i photo.jpg --thumbnail 400x400 \\
    --sepia --border 5x5 --border-color "#8B4513"
`);
}

async function executeImageMagick(
  inputPath: string,
  outputPath: string,
  args: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn("convert", [inputPath, ...args, outputPath]);

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ImageMagick error (code ${code}): ${stderr}`));
      }
    });

    process.on("error", (error) => {
      reject(new Error(`Failed to execute ImageMagick: ${error.message}`));
    });
  });
}

function buildImageMagickArgs(options: any): string[] {
  const args: string[] = [];

  // Crop operations
  if (options.crop) {
    args.push("-crop", options.crop);
    args.push("+repage"); // Remove canvas offset
  }

  if (options["crop-center"]) {
    args.push("-gravity", "center");
    args.push("-crop", options["crop-center"]);
    args.push("+repage");
  }

  if (options["crop-square"]) {
    // This requires getting image dimensions first, handled separately
    args.push("-gravity", "center");
    args.push("-crop", "1:1");
    args.push("+repage");
  }

  // Rotation operations
  if (options.rotate) {
    args.push("-rotate", options.rotate);
  }

  if (options["rotate-right"]) {
    args.push("-rotate", "90");
  }

  if (options["rotate-left"]) {
    args.push("-rotate", "-90");
  }

  if (options["flip-horizontal"]) {
    args.push("-flop");
  }

  if (options["flip-vertical"]) {
    args.push("-flip");
  }

  // Scale operations
  if (options.scale) {
    args.push("-resize", `${options.scale}!`); // ! forces exact dimensions
  }

  if (options["scale-width"]) {
    args.push("-resize", `${options["scale-width"]}x`);
  }

  if (options["scale-height"]) {
    args.push("-resize", `x${options["scale-height"]}`);
  }

  if (options["scale-percent"]) {
    args.push("-resize", `${options["scale-percent"]}%`);
  }

  if (options.thumbnail) {
    args.push("-thumbnail", options.thumbnail);
  }

  // Skew operations
  if (options.skew) {
    const [x, y] = options.skew.split("x");
    args.push("-distort", "ScaleRotateTranslate", `0,0 1,1 ${x},${y}`);
  }

  // Effects
  if (options.blur) {
    args.push("-blur", options.blur);
  }

  if (options.sharpen) {
    args.push("-sharpen", options.sharpen);
  }

  if (options.grayscale) {
    args.push("-colorspace", "Gray");
  }

  if (options.sepia) {
    args.push("-sepia-tone", "80%");
  }

  if (options.negate) {
    args.push("-negate");
  }

  // Border
  if (options.border) {
    args.push("-border", options.border);
    if (options["border-color"]) {
      args.push("-bordercolor", options["border-color"]);
    }
  }

  // Quality
  if (options.quality) {
    args.push("-quality", options.quality);
  }

  return args;
}

async function addWatermark(
  inputPath: string,
  outputPath: string,
  options: any
): Promise<void> {
  const args: string[] = [];
  const position = options["watermark-position"] || "SouthEast";
  const opacity = options["watermark-opacity"] || "50";

  if (options["watermark-text"]) {
    // Text watermark
    const fontSize = options["watermark-size"] || "32";
    
    args.push("-gravity", position);
    args.push("-pointsize", fontSize);
    args.push("-fill", "white");
    args.push("-stroke", "black");
    args.push("-strokewidth", "2");
    args.push("-annotate", `+10+10`, options["watermark-text"]);
    
    // Apply opacity
    args.push("(", "+clone", "-background", "black", "-shadow", `${100 - parseInt(opacity)}x3+0+0`, ")", "+swap");
    args.push("-composite");
  } else if (options.watermark) {
    // Image watermark
    const watermarkPath = options.watermark;
    
    if (!existsSync(watermarkPath)) {
      throw new Error(`Watermark image not found: ${watermarkPath}`);
    }

    // Use composite command for image watermark
    return new Promise((resolve, reject) => {
      const compositeArgs = [
        "-gravity", position,
        "-dissolve", opacity,
        watermarkPath,
        inputPath,
        outputPath
      ];

      const process = spawn("composite", compositeArgs);

      let stderr = "";

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Watermark error (code ${code}): ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`Failed to apply watermark: ${error.message}`));
      });
    });
  }

  return executeImageMagick(inputPath, outputPath, args);
}

function generateOutputPath(inputPath: string, format?: string): string {
  const dir = inputPath.includes("/") ? inputPath.substring(0, inputPath.lastIndexOf("/")) : ".";
  const filename = basename(inputPath, extname(inputPath));
  const ext = format || extname(inputPath).substring(1) || "jpg";
  return join(dir, `${filename}_modified.${ext}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
      
      // Crop
      crop: { type: "string" },
      "crop-center": { type: "string" },
      "crop-square": { type: "boolean" },
      
      // Rotate
      rotate: { type: "string" },
      "rotate-right": { type: "boolean" },
      "rotate-left": { type: "boolean" },
      "flip-horizontal": { type: "boolean" },
      "flip-vertical": { type: "boolean" },
      
      // Scale
      scale: { type: "string" },
      "scale-width": { type: "string" },
      "scale-height": { type: "string" },
      "scale-percent": { type: "string" },
      thumbnail: { type: "string" },
      
      // Skew
      skew: { type: "string" },
      
      // Watermark
      watermark: { type: "string" },
      "watermark-text": { type: "string" },
      "watermark-position": { type: "string" },
      "watermark-opacity": { type: "string" },
      "watermark-size": { type: "string" },
      
      // Effects
      blur: { type: "string" },
      sharpen: { type: "string" },
      grayscale: { type: "boolean" },
      sepia: { type: "boolean" },
      negate: { type: "boolean" },
      border: { type: "string" },
      "border-color": { type: "string" },
      
      // Format
      format: { type: "string" },
      quality: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (!values.input) {
    log("❌ Error: Input image is required", "red");
    log("\nRun with --help for usage information", "yellow");
    process.exit(1);
  }

  const inputPath = values.input as string;

  if (!existsSync(inputPath)) {
    log(`❌ Error: Input file not found: ${inputPath}`, "red");
    process.exit(1);
  }

  const outputPath = (values.output as string) || generateOutputPath(inputPath, values.format as string);

  log(`\n🎨 Image Manipulation Tool\n`, "bright");
  log(`📥 Input:  ${inputPath}`, "blue");
  log(`📤 Output: ${outputPath}`, "blue");
  log("");

  try {
    // Check if we need to apply watermark
    const hasWatermark = values.watermark || values["watermark-text"];
    
    if (hasWatermark) {
      // Process without watermark first
      const tempPath = outputPath.replace(/(\.[^.]+)$/, "_temp$1");
      const args = buildImageMagickArgs(values);
      
      if (args.length > 0) {
        log("⚙️  Applying transformations...", "cyan");
        await executeImageMagick(inputPath, tempPath, args);
      } else {
        // No transformations, just copy input
        await Bun.write(tempPath, Bun.file(inputPath));
      }
      
      log("🏷️  Adding watermark...", "cyan");
      await addWatermark(tempPath, outputPath, values);
      
      // Clean up temp file
      await Bun.write(tempPath, "");
      
    } else {
      // No watermark, just apply transformations
      const args = buildImageMagickArgs(values);
      
      if (args.length === 0) {
        log("⚠️  No operations specified. Use --help for options.", "yellow");
        process.exit(1);
      }
      
      log("⚙️  Processing image...", "cyan");
      await executeImageMagick(inputPath, outputPath, args);
    }

    log("\n✨ Image processing complete!", "green");
    log(`📁 Saved to: ${outputPath}`, "green");

  } catch (error) {
    log(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`, "red");
    log("\n💡 Make sure ImageMagick is installed:", "yellow");
    log("   Ubuntu/Debian: sudo apt-get install imagemagick", "yellow");
    log("   macOS: brew install imagemagick", "yellow");
    process.exit(1);
  }
}

main();