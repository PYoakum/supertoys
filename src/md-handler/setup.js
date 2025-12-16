#!/usr/bin/env bun

/**
 * Setup Script for Bun Request Handler
 * 
 * Creates the necessary database, configuration, and sample data
 * to get started with the request handler.
 * 
 * Run: bun run setup.js
 */

import { Database } from 'bun:sqlite';

const DB_PATH = './content.db';
const CONFIG_PATH = './config.yaml';

// ============================================================================
// Create Database Schema
// ============================================================================

function createDatabase() {
  console.log('📦 Creating database...');
  
  const db = new Database(DB_PATH);
  
  // Create posts table
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      markdown TEXT,
      excerpt TEXT,
      author TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      category TEXT,
      tags TEXT,
      featured_image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      published_at DATETIME
    )
  `);

  // Create pages table
  db.run(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      markdown TEXT,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create articles table
  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      markdown TEXT,
      author TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug)');
  
  console.log('✅ Database schema created');
  
  return db;
}

// ============================================================================
// Insert Sample Data
// ============================================================================

function insertSampleData(db) {
  console.log('📝 Inserting sample data...');
  
  const insertPost = db.prepare(`
    INSERT OR IGNORE INTO posts 
    (title, slug, content, markdown, excerpt, author, status, category, tags, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  // Sample posts with markdown templates
  const posts = [
    {
      title: 'Getting Started with Bun',
      slug: 'getting-started-with-bun',
      content: 'Bun is a fast all-in-one JavaScript runtime. It includes a bundler, test runner, and Node.js-compatible package manager.',
      markdown: `# {{title}}

*By {{author}} on {{created_at | prettyDate}}*

{{content}}

## Why Bun?

Bun is designed for speed and developer experience. It's built from scratch using Zig and JavaScriptCore.

### Key Features

- **Fast startup**: Bun starts up to 4x faster than Node.js
- **Built-in bundler**: No need for webpack or rollup
- **Native TypeScript support**: Run .ts files directly
- **npm compatible**: Use your existing packages

---

© {{currentYear}} {{siteName}}`,
      excerpt: 'Learn how to get started with Bun, the fast JavaScript runtime.',
      author: 'Jane Developer',
      status: 'published',
      category: 'tutorials',
      tags: 'bun,javascript,runtime'
    },
    {
      title: 'Building REST APIs with Bun',
      slug: 'building-rest-apis-with-bun',
      content: 'Learn how to build high-performance REST APIs using Bun\'s built-in HTTP server.',
      markdown: `# {{title}}

*Posted by {{author}} • {{content | readingTime}}*

{{content}}

## Creating Your First API

Here's how to create a simple API endpoint:

\`\`\`javascript
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello World!");
  }
});
\`\`\`

## Adding Routes

You can add routing logic in the fetch handler...

---

Tags: {{tags}}`,
      excerpt: 'Build fast REST APIs with Bun\'s native HTTP server.',
      author: 'John Coder',
      status: 'published',
      category: 'tutorials',
      tags: 'bun,api,rest'
    },
    {
      title: 'Database Patterns in Bun',
      slug: 'database-patterns-in-bun',
      content: 'Explore various database patterns and best practices when working with Bun and SQLite.',
      markdown: `# {{title}}

*{{author}} • {{category | capitalize}}*

{{content}}

## Using SQLite

Bun has built-in SQLite support via \`bun:sqlite\`:

\`\`\`javascript
import { Database } from 'bun:sqlite';
const db = new Database('mydb.sqlite');
\`\`\`

## Best Practices

1. Use prepared statements
2. Handle errors gracefully
3. Close connections when done

---

*Last updated: {{updated_at | date}}*`,
      excerpt: 'Database patterns for Bun applications.',
      author: 'Sarah DBA',
      status: 'published',
      category: 'best-practices',
      tags: 'bun,sqlite,database'
    },
    {
      title: 'Template Processing Deep Dive',
      slug: 'template-processing-deep-dive',
      content: 'A comprehensive guide to template processing with filters and transformations.',
      markdown: `# {{title}}

## Overview

{{content}}

## Available Filters

You can use these filters in your templates:

- \`uppercase\` - Convert to uppercase
- \`lowercase\` - Convert to lowercase  
- \`truncate:N\` - Truncate to N characters
- \`date\` - Format dates nicely
- \`default:value\` - Provide default value

## Examples

Original: {{author}}
Uppercase: {{author | uppercase}}
Truncated: {{content | truncate:50}}

---

Written by {{author}}`,
      excerpt: 'Deep dive into template processing.',
      author: 'Template Master',
      status: 'published',
      category: 'advanced',
      tags: 'templates,filters,processing'
    },
    {
      title: 'Draft Post Example',
      slug: 'draft-post-example',
      content: 'This is a draft post that should not appear in public listings.',
      markdown: `# {{title}}

{{content}}

This post is still being written...`,
      excerpt: 'A draft post.',
      author: 'Draft Writer',
      status: 'draft',
      category: 'misc',
      tags: 'draft'
    }
  ];

  for (const post of posts) {
    insertPost.run(
      post.title,
      post.slug,
      post.content,
      post.markdown,
      post.excerpt,
      post.author,
      post.status,
      post.category,
      post.tags
    );
  }

  // Insert sample pages
  const insertPage = db.prepare(`
    INSERT OR IGNORE INTO pages (title, slug, content, markdown, status)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertPage.run(
    'About Us',
    'about',
    'We are a team of developers passionate about building great software.',
    `# {{title}}

{{content}}

## Our Mission

To make development easier and more enjoyable.

## Contact

Email us at hello@{{siteName | lowercase | slug}}.com`,
    'published'
  );

  insertPage.run(
    'Contact',
    'contact',
    'Get in touch with our team.',
    `# {{title}}

{{content}}

## Ways to Reach Us

- **Email**: contact@example.com
- **Twitter**: @example
- **GitHub**: github.com/example`,
    'published'
  );

  console.log(`✅ Inserted ${posts.length} posts and 2 pages`);
  
  db.close();
}

// ============================================================================
// Create Configuration File
// ============================================================================

async function createConfigFile() {
  console.log('⚙️  Creating configuration file...');
  
  const config = `# Request Handler Configuration
# ================================

# Override mappings - transform content before rendering
overrides:
  # Example: Replace placeholder text
  - field: content
    from: "[SITE_NAME]"
    to: "My Awesome Site"
    global: true

  # Example: Fix old links
  - field: markdown
    from: "http://old-domain.com"
    to: "https://new-domain.com"
    global: true

# Default template delimiters
defaultDelimiters:
  start: "{{"
  end: "}}"

# SQL sanitization - security settings
sqlSanitization:
  # Only allow these tables to be queried
  allowedTables:
    - posts
    - pages
    - articles

  # Only allow these columns
  allowedColumns:
    - id
    - title
    - slug
    - content
    - markdown
    - excerpt
    - author
    - status
    - category
    - tags
    - featured_image
    - created_at
    - updated_at
    - published_at

  # Maximum rows per query
  maxLimit: 100

# HTML sanitization - XSS protection
htmlSanitization:
  # Allowed HTML tags in output
  allowedTags:
    - p
    - br
    - strong
    - em
    - b
    - i
    - u
    - h1
    - h2
    - h3
    - h4
    - h5
    - h6
    - ul
    - ol
    - li
    - a
    - img
    - code
    - pre
    - blockquote
    - table
    - thead
    - tbody
    - tr
    - th
    - td
    - div
    - span
    - hr

  # Allowed attributes per tag
  allowedAttributes:
    a:
      - href
      - title
      - target
      - rel
    img:
      - src
      - alt
      - title
      - width
      - height
    code:
      - class
    pre:
      - class
    div:
      - class
      - id
    span:
      - class
    td:
      - colspan
      - rowspan
    th:
      - colspan
      - rowspan
      - scope
`;

  await Bun.write(CONFIG_PATH, config);
  console.log('✅ Configuration file created');
}

// ============================================================================
// Create Example .env File
// ============================================================================

async function createEnvExample() {
  console.log('🔧 Creating .env.example...');
  
  const envContent = `# Server Configuration
PORT=3000
HOST=0.0.0.0

# Database
DB_PATH=./content.db
CONFIG_PATH=./config.yaml

# API
BASE_PATH=/api

# Caching
CACHE=true
CACHE_TTL=300

# Formatting
PRETTY=false

# Site Info
SITE_NAME=My Site
SITE_URL=http://localhost:3000

# Rate Limiting
RATE_LIMIT=false
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# Environment
NODE_ENV=development
`;

  await Bun.write('.env.example', envContent);
  console.log('✅ .env.example created');
}

// ============================================================================
// Main Setup Function
// ============================================================================

async function setup() {
  console.log('');
  console.log('🚀 Setting up Bun Request Handler');
  console.log('================================');
  console.log('');
  
  // Create database and schema
  const db = createDatabase();
  
  // Insert sample data
  insertSampleData(db);
  
  // Create config file
  await createConfigFile();
  
  // Create .env example
  await createEnvExample();
  
  console.log('');
  console.log('================================');
  console.log('✨ Setup complete!');
  console.log('');
  console.log('To start the server, run:');
  console.log('');
  console.log('  bun run request-handler.js');
  console.log('');
  console.log('Or with custom settings:');
  console.log('');
  console.log('  PORT=8080 bun run request-handler.js');
  console.log('');
  console.log('Available endpoints:');
  console.log('');
  console.log('  GET /                     - Health check');
  console.log('  GET /api/posts            - List posts');
  console.log('  GET /api/posts/:slug      - Get post by slug');
  console.log('  GET /api/posts/:id        - Get post by ID');
  console.log('  GET /api/posts/stream     - Stream all posts');
  console.log('  GET /api/content/:table   - Generic content');
  console.log('');
  console.log('Query parameters:');
  console.log('');
  console.log('  ?limit=10                 - Limit results');
  console.log('  ?offset=0                 - Skip results');
  console.log('  ?page=1                   - Pagination (with limit)');
  console.log('  ?orderBy=created_at       - Sort field');
  console.log('  ?order=DESC               - Sort direction');
  console.log('  ?status=published         - Filter by status');
  console.log('  ?format=json              - Return JSON');
  console.log('  ?pretty=true              - Pretty print HTML');
  console.log('  ?nocache=true             - Bypass cache');
  console.log('');
}

// Run setup
setup().catch(console.error);