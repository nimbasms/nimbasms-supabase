// GET /functions/v1/get-sendernames
//
// Lists the Sender IDs registered on the Nimba SMS account, along with their
// approval status. Wraps `GET /v1/sendernames`.
//
// Query params (all optional):
//   - limit  (default 100, max 1000)
//   - offset (default 0)

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
    const senders = await client.getSenderNames({ limit, offset });
    return jsonResponse(senders);
  } catch (err) {
    const e = err as NimbaSMSError;
    const status = e.status && e.status >= 400 ? e.status : 502;
    return jsonResponse(
      { error: e.message, code: e.code ?? "fetch_failed" },
      { status },
    );
  }
});

function parseIntOr(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
