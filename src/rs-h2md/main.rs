use std::env;
use std::fs;
use std::path::Path;
use std::process;
use regex::Regex;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 || args.contains(&String::from("--help")) || args.contains(&String::from("-h")) {
        show_help();
        process::exit(0);
    }

    let input_file = &args[1];

    if !Path::new(input_file).exists() {
        eprintln!("Error: Input file '{}' does not exist", input_file);
        process::exit(1);
    }

    // Parse output flag
    let output_file = if let Some(pos) = args.iter().position(|x| x == "-o" || x == "--output") {
        if pos + 1 < args.len() {
            Some(args[pos + 1].clone())
        } else {
            eprintln!("Error: -o/--output requires a filename");
            process::exit(1);
        }
    } else {
        None
    };

    // Read input file
    let input_content = fs::read_to_string(input_file)
        .unwrap_or_else(|err| {
            eprintln!("Error reading file '{}': {}", input_file, err);
            process::exit(1);
        });

    // Determine conversion direction
    let input_ext = Path::new(input_file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let (output_content, default_ext) = match input_ext.to_lowercase().as_str() {
        "html" | "htm" => {
            println!("Converting HTML to Markdown...");
            (html_to_markdown(&input_content), "md")
        }
        "md" | "markdown" => {
            println!("Converting Markdown to HTML...");
            (markdown_to_html(&input_content), "html")
        }
        _ => {
            eprintln!("Error: Unsupported file extension '.{}'", input_ext);
            eprintln!("Supported extensions: .html, .htm, .md, .markdown");
            process::exit(1);
        }
    };

    // Determine output filename
    let final_output = output_file.unwrap_or_else(|| {
        let stem = Path::new(input_file)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        format!("{}.{}", stem, default_ext)
    });

    // Write output file
    fs::write(&final_output, output_content)
        .unwrap_or_else(|err| {
            eprintln!("Error writing to '{}': {}", final_output, err);
            process::exit(1);
        });

    println!("✓ Conversion complete: {}", final_output);
}

fn show_help() {
    println!(r#"
HTML/Markdown Converter CLI (Rust)

Usage:
  html-md-converter <input-file> [options]

Options:
  -o, --output <file>    Output file path (default: auto-generated)
  -h, --help             Show this help message

Examples:
  html-md-converter document.html
  html-md-converter document.md -o output.html
  html-md-converter input.html --output result.md

The conversion direction is automatically detected from the input file extension.
"#);
}

fn html_to_markdown(html: &str) -> String {
    let mut markdown = html.to_string();

    // Remove DOCTYPE and html/head/body tags
    let doctype_re = Regex::new(r"(?i)<!DOCTYPE[^>]*>").unwrap();
    markdown = doctype_re.replace_all(&markdown, "").to_string();

    let html_tag_re = Regex::new(r"(?i)<html[^>]*>").unwrap();
    markdown = html_tag_re.replace_all(&markdown, "").to_string();

    markdown = markdown.replace("</html>", "");
    markdown = markdown.replace("</HTML>", "");

    let head_re = Regex::new(r"(?i)<head[^>]*>[\s\S]*?</head>").unwrap();
    markdown = head_re.replace_all(&markdown, "").to_string();

    let body_open_re = Regex::new(r"(?i)<body[^>]*>").unwrap();
    markdown = body_open_re.replace_all(&markdown, "").to_string();

    markdown = markdown.replace("</body>", "");
    markdown = markdown.replace("</BODY>", "");

    // Headers (h1-h6)
    for i in (1..=6).rev() {
        let pattern = format!(r"(?i)<h{}[^>]*>(.*?)</h{}>", i, i);
        let re = Regex::new(&pattern).unwrap();
        markdown = re.replace_all(&markdown, |caps: &regex::Captures| {
            format!("{} {}\n\n", "#".repeat(i), caps[1].trim())
        }).to_string();
    }

    // Bold
    let bold_re = Regex::new(r"(?i)<(strong|b)[^>]*>(.*?)</(strong|b)>").unwrap();
    markdown = bold_re.replace_all(&markdown, "**$2**").to_string();

    // Italic
    let italic_re = Regex::new(r"(?i)<(em|i)[^>]*>(.*?)</(em|i)>").unwrap();
    markdown = italic_re.replace_all(&markdown, "*$2*").to_string();

    // Links
    let link_re = Regex::new(r#"(?i)<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)</a>"#).unwrap();
    markdown = link_re.replace_all(&markdown, "[$2]($1)").to_string();

    // Images
    let img_re1 = Regex::new(r#"(?i)<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*/??>"#).unwrap();
    markdown = img_re1.replace_all(&markdown, "![$2]($1)").to_string();

    let img_re2 = Regex::new(r#"(?i)<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*/??>"#).unwrap();
    markdown = img_re2.replace_all(&markdown, "![$1]($2)").to_string();

    let img_re3 = Regex::new(r#"(?i)<img[^>]*src=["']([^"']*)["'][^>]*/??>"#).unwrap();
    markdown = img_re3.replace_all(&markdown, "![]($1)").to_string();

    // Code blocks
    let code_block_re = Regex::new(r"(?i)<pre[^>]*><code[^>]*>([\s\S]*?)</code></pre>").unwrap();
    markdown = code_block_re.replace_all(&markdown, |caps: &regex::Captures| {
        format!("```\n{}\n```\n\n", caps[1].trim())
    }).to_string();

    // Inline code
    let inline_code_re = Regex::new(r"(?i)<code[^>]*>(.*?)</code>").unwrap();
    markdown = inline_code_re.replace_all(&markdown, "`$1`").to_string();

    // Blockquotes
    let blockquote_re = Regex::new(r"(?i)<blockquote[^>]*>([\s\S]*?)</blockquote>").unwrap();
    markdown = blockquote_re.replace_all(&markdown, |caps: &regex::Captures| {
        let content = caps[1].trim();
        let lines: Vec<&str> = content.split('\n').collect();
        let quoted: Vec<String> = lines.iter().map(|line| format!("> {}", line.trim())).collect();
        format!("{}\n\n", quoted.join("\n"))
    }).to_string();

    // Unordered lists
    let ul_re = Regex::new(r"(?i)<ul[^>]*>([\s\S]*?)</ul>").unwrap();
    markdown = ul_re.replace_all(&markdown, |caps: &regex::Captures| {
        let li_re = Regex::new(r"(?i)<li[^>]*>(.*?)</li>").unwrap();
        li_re.replace_all(&caps[1], "- $1\n").to_string() + "\n"
    }).to_string();

    // Ordered lists
    let ol_re = Regex::new(r"(?i)<ol[^>]*>([\s\S]*?)</ol>").unwrap();
    markdown = ol_re.replace_all(&markdown, |caps: &regex::Captures| {
        let li_re = Regex::new(r"(?i)<li[^>]*>(.*?)</li>").unwrap();
        let mut counter = 1;
        let mut result = String::new();
        for cap in li_re.captures_iter(&caps[1]) {
            result.push_str(&format!("{}. {}\n", counter, &cap[1]));
            counter += 1;
        }
        result + "\n"
    }).to_string();

    // Horizontal rules
    let hr_re = Regex::new(r"(?i)<hr[^>]*/?>").unwrap();
    markdown = hr_re.replace_all(&markdown, "\n---\n\n").to_string();

    // Paragraphs
    let p_re = Regex::new(r"(?i)<p[^>]*>(.*?)</p>").unwrap();
    markdown = p_re.replace_all(&markdown, "$1\n\n").to_string();

    // Line breaks
    let br_re = Regex::new(r"(?i)<br[^>]*/?>").unwrap();
    markdown = br_re.replace_all(&markdown, "\n").to_string();

    // Remove remaining HTML tags
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    markdown = tag_re.replace_all(&markdown, "").to_string();

    // Decode HTML entities
    markdown = markdown.replace("&nbsp;", " ");
    markdown = markdown.replace("&lt;", "<");
    markdown = markdown.replace("&gt;", ">");
    markdown = markdown.replace("&amp;", "&");
    markdown = markdown.replace("&quot;", "\"");
    markdown = markdown.replace("&#39;", "'");

    // Clean up extra whitespace
    let multi_newline_re = Regex::new(r"\n{3,}").unwrap();
    markdown = multi_newline_re.replace_all(&markdown, "\n\n").to_string();

    // Remove leading whitespace from lines
    let lines: Vec<String> = markdown.split('\n')
        .map(|line| {
            if line.trim().starts_with("```") {
                line.trim().to_string()
            } else {
                line.trim_start().to_string()
            }
        })
        .collect();
    markdown = lines.join("\n");

    markdown.trim().to_string()
}

fn markdown_to_html(markdown: &str) -> String {
    let mut html = markdown.to_string();

    // Extract code blocks first
    let code_block_re = Regex::new(r"```([\s\S]*?)```").unwrap();
    let mut code_blocks = Vec::new();
    html = code_block_re.replace_all(&html, |caps: &regex::Captures| {
        code_blocks.push(caps[1].trim().to_string());
        format!("<<<CODEBLOCK_{}>>>", code_blocks.len() - 1)
    }).to_string();

    // Headers
    let h6_re = Regex::new(r"(?m)^######\s+(.+)$").unwrap();
    html = h6_re.replace_all(&html, "<h6>$1</h6>").to_string();

    let h5_re = Regex::new(r"(?m)^#####\s+(.+)$").unwrap();
    html = h5_re.replace_all(&html, "<h5>$1</h5>").to_string();

    let h4_re = Regex::new(r"(?m)^####\s+(.+)$").unwrap();
    html = h4_re.replace_all(&html, "<h4>$1</h4>").to_string();

    let h3_re = Regex::new(r"(?m)^###\s+(.+)$").unwrap();
    html = h3_re.replace_all(&html, "<h3>$1</h3>").to_string();

    let h2_re = Regex::new(r"(?m)^##\s+(.+)$").unwrap();
    html = h2_re.replace_all(&html, "<h2>$1</h2>").to_string();

    let h1_re = Regex::new(r"(?m)^#\s+(.+)$").unwrap();
    html = h1_re.replace_all(&html, "<h1>$1</h1>").to_string();

    // Horizontal rules
    let hr1_re = Regex::new(r"(?m)^---$").unwrap();
    html = hr1_re.replace_all(&html, "<hr>").to_string();

    let hr2_re = Regex::new(r"(?m)^\*\*\*$").unwrap();
    html = hr2_re.replace_all(&html, "<hr>").to_string();

    // Bold
    let bold1_re = Regex::new(r"\*\*(.+?)\*\*").unwrap();
    html = bold1_re.replace_all(&html, "<strong>$1</strong>").to_string();

    let bold2_re = Regex::new(r"__(.+?)__").unwrap();
    html = bold2_re.replace_all(&html, "<strong>$1</strong>").to_string();

    // Italic
    let italic1_re = Regex::new(r"\*(.+?)\*").unwrap();
    html = italic1_re.replace_all(&html, "<em>$1</em>").to_string();

    let italic2_re = Regex::new(r"_(.+?)_").unwrap();
    html = italic2_re.replace_all(&html, "<em>$1</em>").to_string();

    // Images (must come before links)
    let img_re = Regex::new(r"!\[([^\]]*)\]\(([^)]+)\)").unwrap();
    html = img_re.replace_all(&html, r#"<img src="$2" alt="$1">"#).to_string();

    // Links
    let link_re = Regex::new(r"\[([^\]]+)\]\(([^)]+)\)").unwrap();
    html = link_re.replace_all(&html, r#"<a href="$2">$1</a>"#).to_string();

    // Inline code
    let inline_code_re = Regex::new(r"`([^`]+)`").unwrap();
    html = inline_code_re.replace_all(&html, "<code>$1</code>").to_string();

    // Blockquotes
    let blockquote_re = Regex::new(r"(?m)^>\s+(.+)$").unwrap();
    html = blockquote_re.replace_all(&html, "<blockquote>$1</blockquote>").to_string();
    html = html.replace("</blockquote>\n<blockquote>", "\n");

    // Process lists
    let lines: Vec<&str> = html.split('\n').collect();
    let mut processed_lines = Vec::new();
    let mut in_ul = false;
    let mut in_ol = false;

    let ul_re = Regex::new(r"^[\-\*]\s+(.+)$").unwrap();
    let ol_re = Regex::new(r"^\d+\.\s+(.+)$").unwrap();

    for line in lines {
        if ul_re.is_match(line) {
            if in_ol {
                processed_lines.push("</ol>".to_string());
                in_ol = false;
            }
            if !in_ul {
                processed_lines.push("<ul>".to_string());
                in_ul = true;
            }
            let content = ul_re.replace(line, "<li>$1</li>").to_string();
            processed_lines.push(content);
        } else if ol_re.is_match(line) {
            if in_ul {
                processed_lines.push("</ul>".to_string());
                in_ul = false;
            }
            if !in_ol {
                processed_lines.push("<ol>".to_string());
                in_ol = true;
            }
            let content = ol_re.replace(line, "<li>$1</li>").to_string();
            processed_lines.push(content);
        } else {
            if in_ul {
                processed_lines.push("</ul>".to_string());
                in_ul = false;
            }
            if in_ol {
                processed_lines.push("</ol>".to_string());
                in_ol = false;
            }
            processed_lines.push(line.to_string());
        }
    }

    if in_ul {
        processed_lines.push("</ul>".to_string());
    }
    if in_ol {
        processed_lines.push("</ol>".to_string());
    }

    html = processed_lines.join("\n");

    // Wrap paragraphs
    let lines: Vec<&str> = html.split('\n').collect();
    let tag_start_re = Regex::new(r"^<(h[1-6]|ul|ol|li|blockquote|pre|hr|code)").unwrap();
    let tag_end_re = Regex::new(r"</(h[1-6]|ul|ol|li|blockquote|pre|code)>$").unwrap();
    let placeholder_re = Regex::new(r"^<<<CODEBLOCK_\d+>>>$").unwrap();

    let wrapped_lines: Vec<String> = lines.iter().map(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            "".to_string()
        } else if placeholder_re.is_match(trimmed) {
            line.to_string()
        } else if tag_start_re.is_match(trimmed) {
            line.to_string()
        } else if tag_end_re.is_match(trimmed) {
            line.to_string()
        } else if line.starts_with('<') && line.ends_with('>') {
            line.to_string()
        } else {
            format!("<p>{}</p>", line)
        }
    }).collect();

    html = wrapped_lines.join("\n");

    // Restore code blocks
    let placeholder_restore_re = Regex::new(r"<<<CODEBLOCK_(\d+)>>>").unwrap();
    html = placeholder_restore_re.replace_all(&html, |caps: &regex::Captures| {
        let index: usize = caps[1].parse().unwrap();
        format!("<pre><code>{}</code></pre>", code_blocks[index])
    }).to_string();

    // Wrap in HTML structure
    format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Converted Document</title>
</head>
<body>
{}
</body>
</html>"#, html)
}