// src/server.ts
import { loadConfig, hotReload, AppConfig } from "./config";
import { MemoryCache } from "./cache";
import { createHandler } from "./proxy";

const CONFIG_PATH = new URL("./config.yaml", import.meta.url).pathname;

let config: AppConfig = await loadConfig(CONFIG_PATH);
const cache = new MemoryCache(50_000);

hotReload(CONFIG_PATH, (cfg) => {
  config = cfg;
});

const getConfig = () => config;
const handler = createHandler(getConfig, cache);

const [host, portStr] = config.server.bind.split(":");
const port = Number(portStr);

console.log(`\ ⭐️\ \x1b[32mp_cache\x1b[0m \x1b[93m- listening on ➡︎ http://${host}:${port}\x1b[0m`);
Bun.serve({
  hostname: host,
  port,
  fetch: handler,
});
