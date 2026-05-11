// GET /functions/v1/check-balance
//
// Returns the SMS credit balance and approved Sender IDs of the configured
// Nimba SMS account. Useful for admin dashboards and pre-flight checks.

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { NimbaSMSClient, NimbaSMSError } from "../_shared/nimba-client.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

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
    const [balance, senders] = await Promise.all([
      client.getBalance(),
      client.getSenderNames({ limit: 100 }),
    ]);
    return jsonResponse({
      balance,
      sender_names: senders.results ?? [],
    });
  } catch (err) {
    const e = err as NimbaSMSError;
    const status = e.status && e.status >= 400 ? e.status : 502;
    return jsonResponse(
      { error: e.message, code: e.code ?? "fetch_failed" },
      { status },
    );
  }
});
