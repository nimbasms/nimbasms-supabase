// GET /functions/v1/list-messages
//
// Lists messages stored by Nimba SMS for the configured account. Wraps
// `GET /v1/messages`.
//
// Query params (all optional):
//   - limit  (default 100)
//   - offset (default 0)
//   - search (free-text filter)
//   - status (e.g. `sent`, `received`, `failure`, `no_credit`, `not_available`)

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { NimbaSMSClient, NimbaSMSError } from "../_shared/nimba-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const url = new URL(req.url);
  const limit = parseIntOr(url.searchParams.get("limit"), 100);
  const offset = parseIntOr(url.searchParams.get("offset"), 0);
  const search = url.searchParams.get("search") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;

  let client: NimbaSMSClient;
  try {
    client = NimbaSMSClient.fromEnv();
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message, code: "configuration_error" },
      { status: 500 },
    );
  }

  try {
    const messages = await client.listMessages({
      limit,
      offset,
      search,
      status,
    });
    return jsonResponse(messages);
  } catch (err) {
    const e = err as NimbaSMSError;
    const code = e.status && e.status >= 400 ? e.status : 502;
    return jsonResponse(
      { error: e.message, code: e.code ?? "fetch_failed" },
      { status: code },
    );
  }
});

function parseIntOr(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
