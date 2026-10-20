/**
 * The demo's server: one command, one URL.
 *
 * It builds the browser bundle and the sender, runs the sender so the page has
 * an artifact to paint, and serves the page.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import { buildSender, publicDir, runSender } from "./lib.mjs";

await import("./build.mjs");
buildSender();
runSender();

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];
  const name = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const file = join(publicDir, normalize(name));
  if (!file.startsWith(publicDir)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  readFile(file)
    .then((body) => {
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404).end("not found");
    });
});

server.listen(port, () => {
  console.log(`tessellio-demo: open http://localhost:${port}`);
});
