import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleQuery } from "./routes/query.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "project-agent" });
});

app.post("/query", handleQuery);

const port = Number(process.env.PORT ?? 3031);
app.listen(port, () => {
  console.log(`[project-agent] listening on :${port}`);
});
