import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port <= startPort + 1; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`NORAH Core could not bind to either supported port ${startPort} or ${startPort + 1}.`);
}

// The web build is served same-origin, so it never needed CORS. The
// Capacitor Android build is a genuinely different origin (Capacitor's
// default androidScheme is "https", so the app runs from
// https://localhost) calling this server's absolute /api/trpc URL with
// credentials: "include". Without explicit CORS headers, the WebView
// blocks every response before the frontend's tRPC client ever sees it —
// which surfaces in the app as "I couldn't reach the assistant core just
// now" regardless of whether the LLM provider itself is configured
// correctly. This allowlist covers the Capacitor app and local dev
// origins; it intentionally does not reflect arbitrary origins.
const CORS_ALLOWED_ORIGINS = [
  /^https:\/\/localhost(?::\d+)?$/, // Capacitor default androidScheme
  /^capacitor:\/\/localhost$/, // legacy/iOS Capacitor scheme
  /^https?:\/\/localhost(?::\d+)?$/, // local web dev
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
];

function applyCors(app: express.Express) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_ALLOWED_ORIGINS.some(pattern => pattern.test(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  applyCors(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // Stable identity endpoint used by the native client to distinguish NORAH Core
  // from any unrelated service that happens to listen on localhost:3000/3001.
  app.get("/api/norah/health", (_req, res) => {
    res.status(200).json({ service: "norah-core", apiVersion: 1 });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
