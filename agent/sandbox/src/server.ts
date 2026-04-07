import "dotenv/config";
import express from "express";
import cors from "cors";
import queryRouter from "./routes/query.js";

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGINS = process.env.CORS_ORIGINS ?? "*";

// Prevent EPIPE / ECONNRESET from the SDK child-process pipe from crashing
// the server. These happen when the agent process is aborted mid-write.
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE" || err.code === "ECONNRESET") {
    console.warn("[process] Suppressed pipe error:", err.code);
    return;
  }
  console.error("[process] Uncaught exception:", err);
  process.exit(1);
});

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json());

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/query", queryRouter);

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Claude Agent Server running on http://localhost:${PORT}`);
  console.log(`  POST  /query            – start a streaming agent session`);
  console.log(`  GET   /query/sessions   – list active sessions`);
  console.log(`  DELETE /query/sessions/:id – abort a session`);
  console.log(`  GET   /health           – health check`);
});
