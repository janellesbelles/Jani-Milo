const NOMI_API = "https://api.nomi.ai";
const KINDROID_API = "https://api.kindroid.ai/v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PublicError extends Error {
  constructor(message, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function requireApiKey(value, provider) {
  const key = text(value, 300);
  if (!key) throw new PublicError(`Enter your ${provider} API key.`);
  if (provider === "Kindroid" && !key.startsWith("kn_")) {
    throw new PublicError("That does not look like a Kindroid API key.");
  }
  return key;
}

function requireCompanionId(value, provider) {
  const id = text(value, 160);
  if (!id) throw new PublicError(`Enter the ${provider === "Nomi" ? "Nomi" : "Kindroid Kin"} ID.`);
  if (provider === "Nomi" && !UUID_PATTERN.test(id)) throw new PublicError("That Nomi ID is not valid.");
  return id;
}

function requireMessage(value, provider) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new PublicError("Write a message first.");
  const limit = provider === "Nomi" ? 800 : 4000;
  if (raw.length > limit) throw new PublicError(`${provider} messages must be ${limit} characters or fewer.`);
  return raw;
}

function friendlyNomiError(type, status) {
  const messages = {
    Unauthorized: "That Nomi API key was not accepted.",
    InvalidAPIKey: "That does not look like a valid Nomi API key.",
    NomiNotFound: "That Nomi was not found on this account.",
    NomiStillResponding: "This Nomi is still finishing the previous reply. Wait until they stop before asking again.",
    NomiNotReady: "This Nomi is not ready for a message yet.",
    NoReply: "This Nomi took longer than the API reply window. Check the normal chat before trying again.",
    OngoingVoiceCallDetected: "This Nomi is in a voice call right now.",
    LimitExceeded: "Your Nomi daily message quota has been reached.",
    MessageLengthLimitExceeded: "That message is too long for this Nomi account.",
    TooManyRequests: "Nomi is receiving requests too quickly. Wait a moment and try again.",
  };
  return messages[type] || `Nomi could not complete that request (${status}).`;
}

async function upstreamJson(fetchImpl, url, options, provider, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {...options, signal: AbortSignal.timeout(timeoutMs)});
  } catch (error) {
    if (error?.name === "TimeoutError") throw new PublicError(`${provider} took too long to answer.`, 504, "UPSTREAM_TIMEOUT");
    throw new PublicError(`Couldn't reach ${provider}. Try again in a moment.`, 502, "UPSTREAM_NETWORK");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const type = data?.error?.type;
    const message = provider === "Nomi"
      ? friendlyNomiError(type, response.status)
      : `Kindroid could not complete that request (${response.status}).`;
    throw new PublicError(message, response.status >= 500 ? 502 : response.status, type || "UPSTREAM_ERROR");
  }
  return data;
}

async function kindroidFetch(fetchImpl, route, options = {}, timeoutMs = 90_000) {
  let response;
  try {
    response = await fetchImpl(`${KINDROID_API}${route}`, {...options, signal: AbortSignal.timeout(timeoutMs)});
  } catch (error) {
    if (error?.name === "TimeoutError") throw new PublicError("Kindroid took too long to answer.", 504, "UPSTREAM_TIMEOUT");
    throw new PublicError("Couldn't reach Kindroid. Try again in a moment.", 502, "UPSTREAM_NETWORK");
  }
  const body = await response.text();
  if (!response.ok) {
    const messages = {
      401: "That Kindroid API key was not accepted.",
      403: "This Kindroid account cannot use that API request.",
      404: "That Kindroid Kin ID was not found.",
      409: "Kindroid could not accept that message in the current chat state.",
      429: "Kindroid is receiving requests too quickly. Wait a moment and try again.",
    };
    throw new PublicError(messages[response.status] || `Kindroid could not complete that request (${response.status}).`, response.status >= 500 ? 502 : response.status, "UPSTREAM_ERROR");
  }
  if (body.trimStart().startsWith("<<ERROR>>") || body.trimStart().startsWith("<<HTTP_ERROR>>")) {
    throw new PublicError("Kindroid returned an error while generating the reply.", 502, "UPSTREAM_GENERATION_ERROR");
  }
  return body;
}

export async function handleHeartAction(body, {fetchImpl = fetch} = {}) {
  const action = text(body?.action, 40);

  if (action === "list-nomis") {
    const apiKey = requireApiKey(body.apiKey, "Nomi");
    const data = await upstreamJson(fetchImpl, `${NOMI_API}/v1/nomis`, {
      headers: {Authorization: apiKey, Accept: "application/json"},
    }, "Nomi", 35_000);
    const nomis = Array.isArray(data.nomis)
      ? data.nomis.map(item => ({uuid:text(item?.uuid, 80), name:text(item?.name, 100)})).filter(item => item.uuid && item.name)
      : [];
    return {nomis};
  }

  if (action === "chat-nomi") {
    const apiKey = requireApiKey(body.apiKey, "Nomi");
    const companionId = requireCompanionId(body.companionId, "Nomi");
    const messageText = requireMessage(body.messageText, "Nomi");
    const data = await upstreamJson(fetchImpl, `${NOMI_API}/v1/nomis/${encodeURIComponent(companionId)}/chat`, {
      method: "POST",
      headers: {Authorization: apiKey, "Content-Type":"application/json", Accept:"application/json"},
      body: JSON.stringify({messageText}),
    }, "Nomi", 45_000);
    const replyText = text(data?.replyMessage?.text, 12_000);
    if (!replyText) throw new PublicError("Nomi returned an empty reply.", 502, "EMPTY_REPLY");
    return {replyText, sent:text(data?.replyMessage?.sent, 80)};
  }

  if (action === "verify-kindroid") {
    const apiKey = requireApiKey(body.apiKey, "Kindroid");
    const companionId = requireCompanionId(body.companionId, "Kindroid");
    const route = `/get-chat-messages?ai_id=${encodeURIComponent(companionId)}&limit=1`;
    await kindroidFetch(fetchImpl, route, {headers:{Authorization:`Bearer ${apiKey}`, Accept:"application/json"}}, 35_000);
    return {ok:true};
  }

  if (action === "chat-kindroid") {
    const apiKey = requireApiKey(body.apiKey, "Kindroid");
    const companionId = requireCompanionId(body.companionId, "Kindroid");
    const message = requireMessage(body.messageText, "Kindroid");
    const replyText = (await kindroidFetch(fetchImpl, "/send-message", {
      method: "POST",
      headers: {Authorization:`Bearer ${apiKey}`, "Content-Type":"application/json", Accept:"text/plain"},
      body: JSON.stringify({ai_id:companionId, message, stream:false}),
    })).trim();
    if (!replyText) throw new PublicError("Kindroid returned an empty reply.", 502, "EMPTY_REPLY");
    return {replyText};
  }

  throw new PublicError("Unknown API action.", 400, "UNKNOWN_ACTION");
}

function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { throw new PublicError("Request body must be valid JSON."); }
  }
  return {};
}

export default async function handler(request, response) {
  const requestId = crypto.randomUUID();
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "GET") {
    return response.status(200).json({ok:true, mode:"memory-only-credentials"});
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({error:"Method not allowed."});
  }

  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > 20_000) return response.status(413).json({error:"Request too large."});
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return response.status(403).json({error:"Cross-site requests are not allowed."});
  }
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.host) return response.status(403).json({error:"Origin not allowed."});
    } catch {
      return response.status(403).json({error:"Origin not allowed."});
    }
  }

  let action = "unknown";
  try {
    const body = parseBody(request);
    action = text(body.action, 40) || "unknown";
    const result = await handleHeartAction(body);
    return response.status(200).json(result);
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500;
    const code = error instanceof PublicError ? error.code : "INTERNAL_ERROR";
    console.error("heart_api_error", {requestId, action, status, code});
    return response.status(status).json({error:error instanceof PublicError ? error.message : "The cloud bridge hit an unexpected error.", requestId});
  }
}
