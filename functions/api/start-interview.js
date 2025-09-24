export async function onRequestPost({ request, env }) {
  try {
    console.log("=== start-interview invoked ===");

    const body = await safeJson(request);
    const rulebaseUuid = body?.rulebaseUuid || "ecd9a42b-a16c-4625-86a1-02ec2986a219";
    const languageCode = body?.languageCode || "en";

    console.log("Input:", { rulebaseUuid, languageCode });

    console.log("1) Requesting OAuth access token...");
    const { access_token } = await getAccessToken(env);
    console.log("1) Got access token (length):", access_token?.length);

    console.log("2) Creating case with Engine REST API...");
    const { caseId } = await createCaseWithFallback(env, access_token, {
      rulebaseUuid,
      languageCode
    });
    console.log("2) Created case:", caseId);

    console.log("3) Getting security session token for case:", caseId);
    const securitySessionToken = await getSecuritySessionToken(env, access_token, caseId);
    console.log("3) Got security session token (length):", securitySessionToken?.length);

    console.log("=== start-interview completed successfully ===");

    return json({ caseId, securitySessionToken });
  } catch (err) {
    console.error("!!! start-interview failed:", err);
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
  console.log("OAuth response status:", resp.status);
  const text = await resp.text();
  console.log("OAuth response body:", text);
  if (!resp.ok) throw new Error(`IDP token error ${resp.status}: ${text}`);
  return JSON.parse(text);
}

async function createCaseWithFallback(env, accessToken, { rulebaseUuid, languageCode }) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/rest/v1/cases`;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": `Bearer ${accessToken}`,
  };
  if (env.TENANT_ID) headers["x-tenant-id"] = env.TENANT_ID;

  const shapeA = { rulebaseUuid, languageCode, applicants: [{ lifeId: 1 }] };
  console.log("CreateCase ShapeA payload:", shapeA);

  let resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(shapeA) });
  let text = await resp.text();
  console.log("CreateCase ShapeA status:", resp.status, "body:", text);

  if (!resp.ok) {
    const shapeB = { rulebase: { rulebaseUuid }, languageCode, applicants: [{ lifeId: 1 }] };
    console.log("CreateCase retry ShapeB payload:", shapeB);
    resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(shapeB) });
    text = await resp.text();
    console.log("CreateCase ShapeB status:", resp.status, "body:", text);
    if (!resp.ok) throw new Error(`Create case error ${resp.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const caseId = data.caseId || data.id || data.uuid || data.caseUuid;
  if (!caseId) throw new Error("No caseId in create case response");
  return { caseId };
}

async function getSecuritySessionToken(env, accessToken, caseId) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/token/v1/${caseId}/securitysessiontoken`;

  const headers = {
    "Accept": "application/json",
    "Authorization": `Bearer ${accessToken}`,
  };
  if (env.TENANT_ID) headers["x-tenant-id"] = env.TENANT_ID;

  let resp = await fetch(url, { method: "POST", headers });
  let text = await resp.text();
  console.log("GetSessionToken POST status:", resp.status, "body:", text);

  if (resp.status === 404 || resp.status === 405) {
    resp = await fetch(url, { method: "GET", headers });
    text = await resp.text();
    console.log("GetSessionToken GET status:", resp.status, "body:", text);
  }
  if (!resp.ok) throw new Error(`Get session token error ${resp.status}: ${text}`);

  try {
    const j = JSON.parse(text);
    return j.securitySessionToken || j.token || j.value;
  } catch {
    return text.trim();
  }
}
