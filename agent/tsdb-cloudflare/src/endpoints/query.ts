/**
 * POST /api/query/experiment — Run an experiment metric query.
 *
 * Parses ExperimentQueryRequest, builds the internal ExperimentQuery,
 * runs the engine, and returns ExperimentQueryResponse.
 */

import type { Env } from "../env";
import type {
  ExperimentManyQueryRequest,
  ExperimentQueryRequest,
} from "../models/dtos";
import { buildExperimentQuery } from "../models/dtos";
import { queryExperiment, queryMany } from "../query/experiment-engine";

export async function handleQuery(
  request: Request,
  env: Env,
): Promise<Response> {
  const body: ExperimentQueryRequest = await request.json();

  if (!body.envId || !body.flagKey || !body.metricEvent) {
    return new Response("Missing required fields", { status: 400 });
  }

  const query = buildExperimentQuery(body);
  const result = await queryExperiment(env.TSDB_BUCKET, query);

  return Response.json(result);
}

export async function handleQueryMany(
  request: Request,
  env: Env,
): Promise<Response> {
  const body: ExperimentManyQueryRequest = await request.json();

  if (!body.envId || !body.flagKey || !body.metricEvent) {
    return new Response("Missing required fields", { status: 400 });
  }

  const query = buildExperimentQuery(body);
  const result = await queryMany(
    env.TSDB_BUCKET,
    query,
    body.guardrailEvents?.filter(Boolean),
  );

  return Response.json(result);
}
