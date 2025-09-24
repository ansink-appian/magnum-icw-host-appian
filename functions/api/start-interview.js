export async function onRequestPost({ request, env }) {
  try {
    console.log("=== start-interview invoked ===");

    // We’ll accept language override from the caller, but default to your payload value.
    const reqBody = await safeJson(request);
    const languageOverride = reqBody?.languageCode; // optional

    console.log("Input (optional):", { languageOverride });

    console.log("1) Requesting OAuth access token…");
    const { access_token } = await getAccessToken(env);
    console.log("1) Got access token (length):", access_token?.length);

    console.log("2) Creating case with your custom payload…");
    const { caseId } = await createCaseWithCustomPayload(env, access_token, languageOverride);
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

/* ------------------------ Helpers ------------------------ */
// Helper to generate a RFC4122 v4 UUID (crypto-based, works in CF Workers/Pages)
function generateUuid() {
  // Create array of 16 random bytes
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);

  // Per RFC4122: set bits for version and `clock_seq_hi_and_reserved`
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;

  const bth = [...Array(256).keys()].map(i => i.toString(16).padStart(2, "0"));
  return (
    bth[buf[0]] + bth[buf[1]] + bth[buf[2]] + bth[buf[3]] + "-" +
    bth[buf[4]] + bth[buf[5]] + "-" +
    bth[buf[6]] + bth[buf[7]] + "-" +
    bth[buf[8]] + bth[buf[9]] + "-" +
    bth[buf[10]] + bth[buf[11]] + bth[buf[12]] + bth[buf[13]] + bth[buf[14]] + bth[buf[15]]
  );
}

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

  console.log("OAuth status:", resp.status);
  const tokText = await resp.text();
  console.log("OAuth body:", tokText);

  if (!resp.ok) throw new Error(`IDP token error ${resp.status}: ${tokText}`);
  const tokJson = JSON.parse(tokText);
  if (!tokJson.access_token) throw new Error("No access_token in IDP response");
  return tokJson;
}

async function createCaseWithCustomPayload(env, accessToken, languageOverride) {
  const base = env.SERVICE_URL.replace(/\/+$/, "");
  const url = `${base}/engine/rest/v1/cases`;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json",
    "Authorization": `Bearer ${accessToken}`,
  };
  if (env.TENANT_ID) headers["x-tenant-id"] = env.TENANT_ID;

  // === Your payload as a JS object ===
  const payload = {
    language: languageOverride || "en_GB",
    rulebaseUuid: "ecd9a42b-a16c-4625-86a1-02ec2986a219",
    bootstrapType: "HOST_APP",
    mandatoryValidationsSettings: {
      validateOnNextForm: false,
      validateOnPreviousForm: false,
      validateOnSubmit: false
    },
    bootstrapData: {
      attributes: [
        { attribute: "case.ApplicationID", valueAsString: generateUuid(), questionDefinitionUuid: "8eee4ccc-548e-4304-8847-4d781534e88b" },
        { attribute: "case.ClientCompany", valueAsString: "Swiss Re Core Library", questionDefinitionUuid: "21e9fdc3-2f0a-4cad-a18c-51d52415d997" },
        { attribute: "case.UnderwritingRegion", valueAsString: "Europe", questionDefinitionUuid: "a9cd8c82-49cb-4265-9277-84e6f5bc21b3" },
        { attribute: "case.CountryOfContract", valueAsString: "Netherlands", questionDefinitionUuid: "4632d0af-3bd1-47ee-8fbc-c7601c91b980" },
        { attribute: "case.SalesChannel", valueAsString: "Broker", questionDefinitionUuid: "48c081b0-9c04-4391-8830-23cdffc1e6eb" },
        { attribute: "case.CurrencyCode", valueAsString: "EUR", questionDefinitionUuid: "68c9f461-8988-4c61-b120-ecc3937dd74c" },
        { attribute: "case.life.LifeID", valueAsString: "life700998450", questionDefinitionUuid: "400f86c3-bf38-4bfb-bf1e-cf0708931f5e" },
        { attribute: "case.life.Gender", valueAsString: "Male", questionDefinitionUuid: "acb46ed7-8463-4ff9-bf1b-7e03cae056ec" },
        { attribute: "case.life.DateOfBirth", valueAsString: "1984-02-02", questionDefinitionUuid: "05ad5b82-5674-4691-a411-2ef05854f040" },
        { attribute: "case.life.SmokingStatus", valueAsString: "Non-smoker", questionDefinitionUuid: "e16fd13c-365a-4cd6-9b2a-f990fb1d5d5b" },
        { attribute: "case.life.product.LifeRole", valueAsString: "Main Life", questionDefinitionUuid: "c922f417-7af9-4bb6-a3e6-95ddebc3f73b" },
        { attribute: "case.life.product.type", valueAsString: "Magnum Go Integration", questionDefinitionUuid: "704f48b6-ebe5-473d-93b5-245b2fec3274" },
        { attribute: "case.life.product.displayName", valueAsString: "Swiss Re Core Library", questionDefinitionUuid: "fb7c0e88-5f30-4856-a6ce-007d88297c12" },
        { attribute: "case.life.product.CoverPurpose", valueAsString: "Key-person protection", questionDefinitionUuid: "5cf219ae-b2ad-4a07-9314-74e35d7da55c" },
        { attribute: "case.life.product.benefit.type", valueAsString: "Life Cover", questionDefinitionUuid: "068fa14a-2d53-4fbc-8a5c-99a928bd3724" },
        { attribute: "case.life.product.benefit.termBasis", valueAsString: "Whole Life", questionDefinitionUuid: "c91c5e11-e45b-4d35-8c38-ec8b974f2615" },
        { attribute: "case.life.product.ID", valueAsString: "0", questionDefinitionUuid: "fb7c0e88-5f30-4856-a6ce-007d88297c12" }
      ]
    }
  };

  console.log("CreateCase payload:", payload);

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  console.log("CreateCase status:", resp.status, "body:", text);

  if (!resp.ok) throw new Error(`Create case error ${resp.status}: ${text}`);

  // Response fields differ per deployment; try common keys
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  const caseId = data.caseId || data.id || data.uuid || data.caseUuid;
  if (!caseId) throw new Error("Create case succeeded but no caseId found in response");
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

  // Some envs return JSON, some return raw token
  try {
    const j = JSON.parse(text);
    return j.securitySessionToken || j.token || j.value || (() => { throw new Error("No token field in JSON"); })();
  } catch {
    return text.trim();
  }
}
