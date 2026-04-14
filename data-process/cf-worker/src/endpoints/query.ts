import type { Env } from "../env";
import type {
  ExperimentQueryRequest,
  ExperimentQueryResponse,
  VariantStats,
  FlagEvalRollup,
  MetricEventRollup,
  FlagEvalEntry,
  MetricEntry,
} from "../models/types";
import { flagEvalRollupKey, metricEventRollupKey } from "../storage/path-helper";

export async function handleQuery(request: Request, env: Env): Promise<Response> {
  const { envId, flagKey, metricEvent, dates } =
    await request.json() as ExperimentQueryRequest;

  if (!envId || !flagKey || !metricEvent || !Array.isArray(dates) || dates.length === 0) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Merge rollup files across all requested dates
  const feUsers = new Map<string, FlagEvalEntry>();
  const meUsers = new Map<string, MetricEntry>();

  await Promise.all(
    dates.map(async (date) => {
      const [feObj, meObj] = await Promise.all([
        env.TSDB_BUCKET.get(flagEvalRollupKey(envId, flagKey, date)),
        env.TSDB_BUCKET.get(metricEventRollupKey(envId, metricEvent, date)),
      ]);

      if (feObj) {
        const fe = await feObj.json<FlagEvalRollup>();
        for (const [uk, entry] of Object.entries(fe.u)) {
          const ex = feUsers.get(uk);
          if (!ex || entry[0] < ex[0]) feUsers.set(uk, entry);
        }
      }

      if (meObj) {
        const me = await meObj.json<MetricEventRollup>();
        for (const [uk, entry] of Object.entries(me.u)) {
          const ex = meUsers.get(uk);
          if (!ex) {
            meUsers.set(uk, [...entry] as MetricEntry);
          } else {
            if (entry[1] < ex[1]) { ex[1] = entry[1]; ex[2] = entry[2]; }
            if (entry[3] > ex[3]) { ex[3] = entry[3]; ex[4] = entry[4]; }
            ex[5] += entry[5];
            ex[6] += entry[6];
            ex[0]  = 1;
          }
        }
      }
    }),
  );

  // Join FE and ME by userKey, group by variant
  const variants = new Map<string, { users: number; conversions: number; sum: number; count: number }>();

  for (const [userKey, feEntry] of feUsers) {
    const variant = feEntry[1];
    if (!variants.has(variant)) variants.set(variant, { users: 0, conversions: 0, sum: 0, count: 0 });
    const g = variants.get(variant)!;
    g.users++;

    const meEntry = meUsers.get(userKey);
    if (meEntry && meEntry[0] === 1) {
      g.conversions++;
      g.sum   += meEntry[5];
      g.count += meEntry[6];
    }
  }

  const result: ExperimentQueryResponse = {};
  for (const [variant, g] of variants) {
    result[variant] = {
      users:           g.users,
      conversions:     g.conversions,
      conversionRate:  g.users > 0 ? g.conversions / g.users : 0,
      totalValue:      g.sum,
      avgValue:        g.count > 0 ? g.sum / g.count : 0,
    } satisfies VariantStats;
  }

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
