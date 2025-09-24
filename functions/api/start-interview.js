export async function onRequestPost({ request, env }) {
  try {
    const { languageCode = "en" } = await safeJson(request);
    // hard-code your rulebase UUID as requested
    const RULEBASE_UUID = "ecd9a42b-a16c-4625-86a1-02ec2986a219";

    const { access_token } = await getAccessToken(env);
    const { caseId } = await createCaseWithFallback(env, access_token, {
      rulebaseUuid: RULEBASE_UUID,
      languageCode
    });
    const securitySessionToken = await getSecuritySessionToken(env, access_token, caseId);

    return json({ caseId, securitySessionToken });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/* ---------- helpers ---------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}

async function getAccessToken(env) {
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", env.CLIENT_ID);
  form.set("client_secret", env.CLIENT_SECRET);
  if (env.OAUTH_SCOPE) form.set("scope", env.OAUTH_SCOPE);

  const resp = await fetch(env.IDP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!resp.ok) throw new Error(`IDP token error ${resp.status}: ${await resp.text()}`);
  const j = await resp.json();
  if (!j.access_token) throw new Error("No access_token in IDP response");
  return j;
}

async function createCaseWithFallback(env, accessToken, { rulebaseUuid, languageCode }) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/rest/v1/cases`;

  const commonHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": `Bearer ${accessToken}`
  };
  if (env.TENANT_ID) commonHeaders["x-tenant-id"] = env.TENANT_ID;

  // Try Shape A first
  let payload = { rulebaseUuid, languageCode };
  let resp = await fetch(url, { method: "POST", headers: commonHeaders, body: JSON.stringify(payload) });

  // If server says "readable" error (400) or media type (415), try Shape B
  if (resp.status === 400 || resp.status === 415) {
    payload = { rulebase: { uuid: rulebaseUuid }, languageCode };
    resp = await fetch(url, { method: "POST", headers: commonHeaders, body: JSON.stringify(payload) });
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Create case error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const caseId = data.caseId || data.id || data.uuid;
  if (!caseId) throw new Error("No caseId in create case response");
  return { caseId };
}

async function getSecuritySessionToken(env, accessToken, caseId) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/token/v1/${caseId}/securitysessiontoken`;

  const headers = {
    "Accept": "application/json",
    "Authorization": `Bearer ${accessToken}`
  };
  if (env.TENANT_ID) headers["x-tenant-id"] = env.TENANT_ID;

  // POST first, fallback to GET
  let resp = await fetch(url, { method: "POST", headers });
  if (resp.status === 404 || resp.status === 405) {
    resp = await fetch(url, { method: "GET", headers });
  }
  if (!resp.ok) throw new Error(`Get session token error ${resp.status}: ${await resp.text()}`);

  const ct = resp.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    const j = await resp.json();
    return j.securitySessionToken || j.token || j.value || (() => { throw new Error("No token in JSON response"); })();
  }
  return (await resp.text()).trim();
}
