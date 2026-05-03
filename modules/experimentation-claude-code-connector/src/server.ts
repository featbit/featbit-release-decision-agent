import express from "express";
import cors from "cors";
import queryRouter from "./routes/query.js";

export interface ConnectorConfig {
  port: number;
  host: string;
  corsOrigins: string | string[];
}

export function createApp(config: Pick<ConnectorConfig, "corsOrigins">) {
  // Suppress EPIPE / ECONNRESET from the SDK's child-process pipe.
  // These can fire when the agent process is aborted mid-write and would
  // otherwise crash the entire connector.
  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE" || err.code === "ECONNRESET") {
      console.warn("[process] Suppressed pipe error:", err.code);
      return;
    }
    console.error("[process] Uncaught exception:", err);
    process.exit(1);
  });

  const app = express();

  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "@featbit/experimentation-claude-code-connector",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/query", queryRouter);

  return app;
}

export function startServer(config: ConnectorConfig): void {
  const app = createApp({ corsOrigins: config.corsOrigins });

  app.listen(config.port, config.host, () => {
    const origin = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
    const permissionMode = process.env.PERMISSION_MODE?.trim() || "bypassPermissions";
    console.log("");
    console.log(`  FeatBit Experimentation × Claude Code Connector`);
    console.log(`  ───────────────────────────────────────────────`);
    console.log(`  Listening at      ${origin}`);
    console.log(`  CORS origins      ${Array.isArray(config.corsOrigins) ? config.corsOrigins.join(", ") : config.corsOrigins}`);
    console.log(`  Permission mode   ${permissionMode}`);
    console.log(`  Endpoints         POST   /query`);
    console.log(`                    GET    /query/sessions`);
    console.log(`                    DELETE /query/sessions/:id`);
    console.log(`                    GET    /health`);
    console.log("");
    console.log(`  Open the FeatBit experiment page and select "Local Claude Code"`);
    console.log(`  to connect this process.`);
    console.log("");
  });
}
