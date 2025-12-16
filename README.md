# supertoys

A suite of super-powered tools for developers human and non-human alike.

## Installation

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run asset-crawler.ts --port 3005 --out ./dist/data
```

# Server Tools

## Crawl Server

**Start the Server:**
```bash
bun run crawl-server 
```

***Example - Issue New Crawl, return JSON***
```bash
curl -X POST http://localhost:3005/assets \
  -H "Content-Type: application/json" \
  -d '{"url":"http://localhost:3001/","mode":"json"}'
```

## Caravan

This sends the CSV file to the conversion server and outputs a result

***Example:***
```bash
bun run caravan.ts --input dist/data/result.csv --endpoint http://localhost:3000/convert --output dist/data/result.json
```

# Automatic Start

### Run Commander (Task Manager)

```bash
bun run commander.ts --config commands.json
```

```json
{
  "name": "Web Crawl and Data Extraction Pipeline",
  "version": "1.0",
  "tasks": [
    {
      "name": "Crawl Website",
      "command": "bun",
      "args": [
        "run",
        "crawl",
        "--url",
        "http://localhost:3001/",
        "--mode",
        "dir",
        "--out",
        "../dist/data",
        "--content-types",
        "text/css,text/html,text/plain,application/json"
      ]
    },
    {
      "name": "Convert HTML to CSV",
      "command": "bun",
      "args": [
        "run",
        "h2c",
        "dist/data/index.html",
        "-o",
        "dist/data/result.csv"
      ]
    },
    {
      "name": "Convert CSV to JSON",
      "command": "bun",
      "args": [
        "run",
        "c2j",
        "--input",
        "dist/data/result.csv",
        "--output",
        "dist/data/result.json"
      ]
    },
    {
      "name": "Extract JSON content to Text File",
      "command": "bun",
      "args": [
        "run",
        "xtractor",
        "--input",
        "dist/data/result.json",
        "--array",
        "data",
        "--key",
        "Content",
        "--output",
        "dist/data/result.txt"
      ]
    },
    {
      "name": "Serve Text File",
      "command": "bun",
      "args": [
        "run",
        "micro",
        "--file=dist/data/result.txt"
      ]
    }
  ]
}
```

# Manual Start

#### Step 1 - Crawl CLI-only

```bash
bun run crawl \
  --url http://localhost:3001/ \
  --mode dir \
  --out ./dist/data \
  --content-types text/css,text/html,text/plain,application/json
```

#### Step 2 - Convert HTML to CSV

```bash
bun run h2c dist/data/index.html -o dist/data/result.csv
```

#### Step 3 - Convert CSV to JSON

```bash
bun run c2j --input dist/data/result.csv --output dist/data/result.json
```

#### Step 4 - Extract JSON content to Text File

```bash
bun run xtractor --input dist/data/result.json --array data --key Content --output dist/data/result.txt
```
