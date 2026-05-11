// POST /functions/v1/create-contact
//
// Creates a new contact on the Nimba SMS account. Wraps `POST /v1/contacts`.
//
// Body:
//   {
//     "numero": "224620000000",   // required, will be auto-formatted
//     "name":   "Aisha Camara",   // optional
//     "groups": ["clients"]       // optional, array of group slugs/names
//   }

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { NimbaSMSClient, NimbaSMSError } from "../_shared/nimba-client.ts";

interface CreateContactBody {
  numero?: string;
  name?: string;
  groups?: string[];
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: CreateContactBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const numero = (body.numero ?? "").toString().trim();
  if (!numero) {
    return jsonResponse({ error: "`numero` is required" }, { status: 400 });
  }
  if (body.groups !== undefined && !Array.isArray(body.groups)) {
    return jsonResponse(
      { error: "`groups` must be an array of strings" },
      { status: 400 },
    );
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
    const contact = await client.createContact({
      numero,
      name: body.name,
      groups: body.groups,
    });
    return jsonResponse(contact, { status: 201 });
  } catch (err) {
    const e = err as NimbaSMSError;
    const status = e.status && e.status >= 400 ? e.status : 502;
    return jsonResponse(
      { error: e.message, code: e.code ?? "create_failed" },
      { status },
    );
  }
});
