// Custom Next.js server that attaches Socket.io
// Run with: node --require ts-node/register server.ts
// Or transpile first via tsconfig-paths

import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { initIO } from "./src/lib/socket-server";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  // Attach Socket.io to the HTTP server
  initIO(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(`[Connect Support] Server ready on http://${hostname}:${port}`);
  });
});
