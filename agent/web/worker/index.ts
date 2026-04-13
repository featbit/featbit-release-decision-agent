import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  WEB_CONTAINER: unknown;
  DATABASE_URL: string;
  NEXT_PUBLIC_SANDBOX_URL?: string;
  TSDB_BASE_URL?: string;
}

export class WebContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "5m";

  envVars: Record<string, string>;

  enableInternet = true;

  constructor(ctx: unknown, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: "production",
      HOSTNAME: "0.0.0.0",
      PORT: "3000",
      DATABASE_URL: env.DATABASE_URL,
      NEXT_PUBLIC_SANDBOX_URL:
        env.NEXT_PUBLIC_SANDBOX_URL ?? "https://sandbox.featbit.ai",
      TSDB_BASE_URL: env.TSDB_BASE_URL ?? "https://tsdb.featbit.ai",
    };
  }

  override onStart(): void {
    console.log("WebContainer started");
  }

  override onStop(): void {
    console.log("WebContainer stopped");
  }

  override onError(error: unknown): void {
    console.error("WebContainer error:", error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.WEB_CONTAINER, "web-singleton");
    return container.fetch(request);
  },
};
