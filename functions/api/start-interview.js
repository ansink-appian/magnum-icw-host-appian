export async function onRequestPost({ request, env }) {
  try {
    const { rulebaseUuid, languageCode = "en" } = await request.json();
    if (!rulebaseUuid) {
      return json({ error: "rulebaseUuid is required" }, 400);
    }
    const { access_token } = await getAccessToken(env);
    const { caseId } = await createCase(env, access_token, { rulebaseUuid, languageCode });
    const securitySessionToken = await getSecuritySessionToken(env, access_token, caseId);
    return json({ caseId, securitySessionToken });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
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
async function createCase(env, accessToken, { rulebaseUuid, languageCode }) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/rest/v1/cases`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  if (env.TENANT_ID) headers["x-tenant-id"] = env.TENANT_ID;
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify({ rulebaseUuid, languageCode }) });
  if (!resp.ok) throw new Error(`Create case error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const caseId = data.caseId || data.id || data.uuid;
  if (!caseId) throw new Error("No caseId in create case response");
  return { caseId };
}
async function getSecuritySessionToken(env, accessToken, caseId) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/token/v1/${caseId}/securitysessiontoken`;
  const headers = { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
  if (env.TENANT_ID) headers["x-tenant-id"] = env.TENANT_ID;
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