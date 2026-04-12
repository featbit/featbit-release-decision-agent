import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  ANALYZE_CONTAINER: DurableObjectNamespace<AnalyzeContainer>;
}

export class AnalyzeContainer extends Container {
  defaultPort = 5058;
  sleepAfter = "5m";

  // Pass Cloudflare TSDB URL to the .NET container
  envVars = {
    TsdbProvider: "cloudflare",
    TsdbBaseUrl__cloudflare: "https://tsdb.featbit.ai",
    ASPNETCORE_URLS: "http://+:5058",
  };

  override onStart(): void {
    console.log("AnalyzeContainer started");
  }

  override onStop(): void {
    console.log("AnalyzeContainer stopped");
  }

  override onError(error: unknown): void {
    console.error("AnalyzeContainer error:", error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Route all requests to a single shared container instance
    const container = getContainer(env.ANALYZE_CONTAINER, "analyze-singleton");
    return container.fetch(request);
  },
};
