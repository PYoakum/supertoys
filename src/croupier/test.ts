#!/usr/bin/env bun

/**
 * Test script for Bun Static Server
 * Tests range request functionality and server responses
 */

const SERVER_URL = "http://localhost:3000";

async function testRequest(description: string, url: string, options: RequestInit = {}) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`   URL: ${url}`);
  
  try {
    const response = await fetch(url, options);
    console.log(`   ✅ Status: ${response.status} ${response.statusText}`);
    
    const headers = Array.from(response.headers.entries());
    if (headers.length > 0) {
      console.log(`   📋 Headers:`);
      headers.forEach(([key, value]) => {
        if (key.toLowerCase().includes('content') || 
            key.toLowerCase().includes('range') || 
            key.toLowerCase().includes('cors')) {
          console.log(`      ${key}: ${value}`);
        }
      });
    }
    
    return response;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log("🚀 Bun Static Server - Test Suite");
  console.log("====================================");
  console.log(`Testing server at: ${SERVER_URL}`);
  console.log("Make sure the server is running!");
  
  // Test 1: Basic GET request
  await testRequest("Basic GET request", `${SERVER_URL}/index.html`);
  
  // Test 2: Range request (first 100 bytes)
  await testRequest(
    "Range request (bytes 0-100)",
    `${SERVER_URL}/index.html`,
    { headers: { "Range": "bytes=0-100" } }
  );
  
  // Test 3: Range request (from byte 100 to end)
  await testRequest(
    "Range request (bytes 100-)",
    `${SERVER_URL}/index.html`,
    { headers: { "Range": "bytes=100-" } }
  );
  
  // Test 4: Range request (middle chunk)
  await testRequest(
    "Range request (bytes 100-200)",
    `${SERVER_URL}/index.html`,
    { headers: { "Range": "bytes=100-200" } }
  );
  
  // Test 5: HEAD request
  await testRequest("HEAD request", `${SERVER_URL}/index.html`, { method: "HEAD" });
  
  // Test 6: OPTIONS request (CORS preflight)
  await testRequest("OPTIONS request (CORS)", SERVER_URL, { method: "OPTIONS" });
  
  // Test 7: 404 Not Found
  await testRequest("404 Not Found", `${SERVER_URL}/nonexistent.html`);
  
  // Test 8: Directory access
  await testRequest("Directory access", `${SERVER_URL}/`);
  
  console.log("\n====================================");
  console.log("✅ Test suite completed!");
  console.log("\nExpected results:");
  console.log("  - Basic GET: 200 OK");
  console.log("  - Range requests: 206 Partial Content");
  console.log("  - HEAD: 200 OK (no body)");
  console.log("  - OPTIONS: 204 No Content (if CORS enabled)");
  console.log("  - 404: 404 Not Found");
  console.log("  - Directory: 200 OK or 403 Forbidden");
}

// Run tests
runTests().catch(console.error);
