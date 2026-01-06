import render from './src/generate-page.js'

// ---------- server ----------
Bun.serve({
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    async fetch(req) {
        const markup = await render()
            return await new Response(
                markup,
                { 
                    headers: { 
                        "content-type": "text/html; charset=utf-8" 
                    } 
                }
            );
    }
})