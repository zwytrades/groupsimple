const API = "https://discord.com/api/v10";
const GH_API = "https://api.github.com";
const SESSION_TTL = 12 * 60 * 60;
const NETWORKS = ["Solana", "Base", "Ethereum", "BNB Chain", "Multichain"];
const TYPES = [
  "Alpha calls", "New launches", "Chart analysis", "Wallet tracking", "Research and DD",
  "Airdrops and farming", "Bots and tools", "Beginners and learning", "Meme culture",
  "Project community", "Raids and shilling", "Dev and builders", "News and updates", "NFT"
];
const REQUESTS = {
  "list": "Free listing",
  "boost-24h": "Free listing + 24 hour boost (0.15 SOL)",
  "boost-3d": "Free listing + 3 day boost (0.35 SOL)",
  "boost-7d": "Free listing + 7 day boost (0.75 SOL)"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(env, origin);

    if (request.method === "OPTIONS") {
      if (origin && !isAllowedOrigin(env, origin)) return new Response("Forbidden origin", { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "groupsimple-worker" }, 200, cors);
      }
      if (url.pathname === "/auth/login" && request.method === "GET") return beginOAuth(request, env);
      if (url.pathname === "/auth/callback" && request.method === "GET") return finishOAuth(request, env);

      if (url.pathname === "/register-commands" && request.method === "GET") {
        const key = url.searchParams.get("key") || "";
        if (!env.SETUP_KEY || !constantTimeEqual(key, env.SETUP_KEY)) return json({ error: "Unauthorized" }, 401, cors);
        return registerCommands(env, cors);
      }

      if (origin && !isAllowedOrigin(env, origin)) return json({ error: "Origin not allowed" }, 403, cors);

      if (url.pathname === "/auth/me" && request.method === "GET") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Please sign in with Discord." }, 401, cors);
        return json({ user: publicUser(user, env) }, 200, cors);
      }

      if (url.pathname === "/submit" && request.method === "POST") {
        const user = await getSessionUser(request, env);
        if (!user) return json({ error: "Please sign in with Discord before submitting a server." }, 401, cors);
        return submitListing(request, env, user, cors);
      }

      if (url.pathname === "/interactions" && request.method === "POST") {
        return handleInteraction(request, env, ctx);
      }

      return json({ error: "Not found" }, 404, cors);
    } catch (error) {
      console.error("groupsimple worker error:", error && error.stack ? error.stack : error);
      return json({ error: "Unexpected server error. Check the Worker logs for details." }, 500, cors);
    }
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function corsHeaders(env, origin) {
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
  if (origin && isAllowedOrigin(env, origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "false";
  }
  return headers;
}

function isAllowedOrigin(env, origin) {
  try {
    const expected = env.ALLOWED_ORIGIN || new URL(env.SITE_URL).origin;
    return new URL(origin).origin === new URL(expected).origin;
  } catch (_) {
    return false;
  }
}

function required(env, names) {
  const missing = names.filter((name) => !String(env[name] || "").trim());
  if (missing.length) throw new Error("Missing Worker configuration: " + missing.join(", "));
}

function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => n.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function encodeUtf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSession(user, env) {
  required(env, ["SESSION_SECRET"]);
  const payload = {
    iss: "groupsimple",
    sub: String(user.id),
    username: String(user.username || "Discord user").slice(0, 80),
    global_name: String(user.global_name || user.username || "Discord user").slice(0, 80),
    avatar: user.avatar || null,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL
  };
  const part = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), new TextEncoder().encode(part));
  return part + "." + b64url(new Uint8Array(signature));
}

async function getSessionUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+([A-Za-z0-9._-]+)$/i);
  if (!match || !env.SESSION_SECRET) return null;
  const token = match[1].split(".");
  if (token.length !== 2) return null;
  try {
    const key = await hmacKey(env.SESSION_SECRET);
    const ok = await crypto.subtle.verify("HMAC", key, fromB64url(token[1]), new TextEncoder().encode(token[0]));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(token[0])));
    if (payload.iss !== "groupsimple" || !payload.sub || Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function isAdminId(id, env) {
  const allowed = String(env.ADMIN_USER_IDS || "").split(/[\s,;]+/).filter(Boolean);
  return allowed.includes(String(id));
}

function publicUser(user, env) {
  return {
    id: user.sub,
    username: user.username,
    globalName: user.global_name,
    avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.sub}/${user.avatar}.png?size=96` : null,
    isAdmin: isAdminId(user.sub, env)
  };
}

async function beginOAuth(request, env) {
  required(env, ["DISCORD_APP_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET", "SITE_URL"]);
  const url = new URL(request.url);
  const callback = new URL("/auth/callback", url.origin).toString();
  const state = randomHex(24);
  const auth = new URL("https://discord.com/oauth2/authorize");
  auth.searchParams.set("client_id", env.DISCORD_APP_ID);
  auth.searchParams.set("redirect_uri", callback);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "identify");
  auth.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      location: auth.toString(),
      "cache-control": "no-store",
      "set-cookie": `gs_oauth_state=${state}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`
    }
  });
}

async function finishOAuth(request, env) {
  const url = new URL(request.url);
  const siteUrl = normalizeSiteUrl(env.SITE_URL);
  const clearState = "gs_oauth_state=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
  const fail = (reason) => new Response(null, {
    status: 302,
    headers: { location: siteUrl + "#gs_error=" + encodeURIComponent(reason), "cache-control": "no-store", "set-cookie": clearState }
  });
  if (url.searchParams.has("error")) return fail("discord_authorization_cancelled");
  const state = url.searchParams.get("state") || "";
  const savedState = cookieValue(request.headers.get("Cookie") || "", "gs_oauth_state");
  if (!state || !savedState || !constantTimeEqual(state, savedState)) return fail("oauth_state_check_failed");
  const code = url.searchParams.get("code");
  if (!code) return fail("missing_authorization_code");

  try {
    required(env, ["DISCORD_APP_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET", "SITE_URL"]);
    const callback = new URL("/auth/callback", url.origin).toString();
    const form = new URLSearchParams({
      client_id: env.DISCORD_APP_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: callback
    });
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form
    });
    if (!tokenResponse.ok) throw new Error("Discord token exchange failed");
    const tokenData = await tokenResponse.json();
    const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userResponse.ok) throw new Error("Discord user lookup failed");
    const discordUser = await userResponse.json();
    const session = await createSession(discordUser, env);
    return new Response(null, {
      status: 302,
      headers: {
        location: siteUrl + "#gs_session=" + encodeURIComponent(session),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "set-cookie": clearState
      }
    });
  } catch (error) {
    console.error("OAuth callback failed:", error && error.message ? error.message : error);
    return fail("discord_login_failed_check_worker_secrets");
  }
}

function normalizeSiteUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function cookieValue(cookies, name) {
  const part = cookies.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}

function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function inviteUrlIsAllowed(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "discord.gg") return /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    if (host === "discord.com" || host === "www.discord.com" || host === "discordapp.com") return /^\/invite\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    if (host === "t.me" || host === "www.t.me" || host === "telegram.me" || host === "www.telegram.me") return /^\/[A-Za-z0-9_+.-]+\/?$/.test(url.pathname);
    return false;
  } catch (_) {
    return false;
  }
}

function slugify(text) {
  return String(text || "server").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "server";
}

function newGroupId(name) {
  return `${slugify(name)}-${randomHex(3)}`;
}

function githubPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function githubHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "groupsimple-worker"
  };
}

function githubUrl(path, env) {
  return `${GH_API}/repos/${env.GITHUB_REPO}/contents/${githubPath(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`;
}

async function githubGet(path, env) {
  const response = await fetch(githubUrl(path, env), { headers: githubHeaders(env) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub read failed for ${path} (${response.status})`);
  const data = await response.json();
  return { sha: data.sha, text: decodeBase64Utf8(data.content || "") };
}

async function githubPut(path, base64Content, message, env, sha) {
  const body = { message, content: base64Content, branch: env.GITHUB_BRANCH || "main" };
  if (sha) body.sha = sha;
  const response = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/contents/${githubPath(path)}`, {
    method: "PUT", headers: githubHeaders(env), body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`GitHub write failed for ${path} (${response.status})`);
    error.status = response.status;
    error.detail = detail.slice(0, 300);
    throw error;
  }
  return response.json();
}

async function githubDelete(path, message, env) {
  const existing = await githubGet(path, env);
  if (!existing) return;
  const response = await fetch(`${GH_API}/repos/${env.GITHUB_REPO}/contents/${githubPath(path)}`, {
    method: "DELETE",
    headers: githubHeaders(env),
    body: JSON.stringify({ message, sha: existing.sha, branch: env.GITHUB_BRANCH || "main" })
  });
  if (!response.ok && response.status !== 404) throw new Error(`GitHub delete failed for ${path} (${response.status})`);
}

async function readGroups(env) {
  required(env, ["GITHUB_TOKEN", "GITHUB_REPO"]);
  const file = await githubGet("groups.json", env);
  if (!file) return { sha: null, data: { groups: [] } };
  let data;
  try { data = JSON.parse(file.text); } catch (_) { throw new Error("groups.json is not valid JSON"); }
  if (!data || !Array.isArray(data.groups)) data = { groups: [] };
  return { sha: file.sha, data };
}

async function changeGroups(env, message, mutator) {
  required(env, ["GITHUB_TOKEN", "GITHUB_REPO"]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readGroups(env);
    const data = { ...current.data, groups: current.data.groups.slice() };
    const result = mutator(data.groups);
    if (result == null) return result;
    try {
      await githubPut("groups.json", encodeUtf8Base64(JSON.stringify(data, null, 2) + "\n"), message, env, current.sha);
      return result;
    } catch (error) {
      if (attempt < 2 && (error.status === 409 || error.status === 422)) continue;
      throw error;
    }
  }
  throw new Error("Could not update groups.json after multiple attempts.");
}

async function submitListing(request, env, user, cors) {
  required(env, ["DISCORD_BOT_TOKEN", "DISCORD_CHANNEL_ID", "GITHUB_TOKEN", "GITHUB_REPO"]);
  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "Invalid JSON request." }, 400, cors); }
  if (body.website) return json({ ok: true }, 200, cors); // honeypot field
  const name = String(body.name || "").trim().slice(0, 70);
  const link = String(body.link || "").trim();
  const network = String(body.network || "");
  const type = String(body.type || "");
  const about = String(body.about || "").trim().slice(0, 1000);
  const requestType = String(body.request || "list");
  if (!name) return json({ error: "Add a server name." }, 400, cors);
  if (!inviteUrlIsAllowed(link)) return json({ error: "Use a valid HTTPS Discord or Telegram invite link." }, 400, cors);
  if (!NETWORKS.includes(network)) return json({ error: "Choose a valid network." }, 400, cors);
  if (!TYPES.includes(type)) return json({ error: "Choose a valid server type." }, 400, cors);
  if (!Object.prototype.hasOwnProperty.call(REQUESTS, requestType)) return json({ error: "Choose a valid listing request." }, 400, cors);

  let image = null;
  if (body.pfp) {
    const match = String(body.pfp).match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match || match[2].length > 600000) return json({ error: "The server image must be a PNG, JPG, or WebP smaller than 450 KB." }, 400, cors);
    const bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
    if (bytes.length > 450000) return json({ error: "The server image must be smaller than 450 KB." }, 400, cors);
    const ext = match[1] === "image/png" ? "png" : (match[1] === "image/webp" ? "webp" : "jpg");
    image = { bytes, type: match[1], filename: `server.${ext}` };
  }

  const requestId = randomHex(6);
  const platform = /(^|\.)t\.me$|telegram\.me$/i.test(new URL(link).hostname) ? "Telegram" : "Discord";
  const fields = [
    { name: "Request ID", value: requestId, inline: true },
    { name: "Group name", value: safeDiscordText(name, 256), inline: true },
    { name: "Invite link", value: link.slice(0, 1024), inline: false },
    { name: "Network", value: network, inline: true },
    { name: "Type", value: type, inline: true },
    { name: "Requested placement", value: REQUESTS[requestType], inline: false },
    { name: "Description", value: safeDiscordText(about || "No description supplied.", 1024), inline: false },
    { name: "Submitted by", value: `${safeDiscordText(user.username, 80)} (Discord ID ${user.sub})`, inline: false }
  ];
  const embed = {
    title: "New groupsimple listing request",
    color: 0x4b7f43,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: `groupsimple request ${requestId}` }
  };
  if (image) embed.image = { url: `attachment://${image.filename}` };
  const payload = {
    content: "A new listing is waiting for moderator review.",
    embeds: [embed],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: "Approve", custom_id: `approve:${requestId}` },
      { type: 2, style: 4, label: "Reject", custom_id: `reject:${requestId}` }
    ] }],
    allowed_mentions: { parse: [] }
  };

  let response;
  if (image) {
    const form = new FormData();
    payload.attachments = [{ id: 0, filename: image.filename }];
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new Blob([image.bytes], { type: image.type }), image.filename);
    response = await fetch(`${API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, {
      method: "POST", headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, body: form
    });
  } else {
    response = await discordBotFetch(`${API}/channels/${env.DISCORD_CHANNEL_ID}/messages`, env, { method: "POST", body: payload });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Discord submission post failed:", response.status, detail.slice(0, 300));
    return json({ error: "Could not send the request to the moderator Discord channel. Check the bot's channel permissions." }, 502, cors);
  }
  return json({ ok: true, message: "Submitted. Join the groupsimple Discord to talk with moderators about your listing." }, 200, cors);
}

function safeDiscordText(value, max = 1024) {
  return String(value || "").replace(/@(everyone|here)/g, "@\u200b$1").slice(0, max) || "—";
}

async function discordBotFetch(url, env, options = {}) {
  const headers = { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== "string") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(body);
  }
  return fetch(url, { ...options, headers, body });
}

async function verifyDiscordSignature(request, rawBody, env) {
  const signatureHex = request.headers.get("X-Signature-Ed25519") || "";
  const timestamp = request.headers.get("X-Signature-Timestamp") || "";
  if (!env.DISCORD_PUBLIC_KEY || !/^[0-9a-f]{128}$/i.test(signatureHex) || !/^\d{10,}$/.test(timestamp)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;
  try {
    const keyBytes = Uint8Array.from(env.DISCORD_PUBLIC_KEY.match(/.{2}/g), (b) => parseInt(b, 16));
    const signature = Uint8Array.from(signatureHex.match(/.{2}/g), (b) => parseInt(b, 16));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signature, new TextEncoder().encode(timestamp + rawBody));
  } catch (error) {
    console.error("Ed25519 verification unavailable or failed:", error && error.message ? error.message : error);
    return false;
  }
}

async function handleInteraction(request, env, ctx) {
  const rawBody = await request.text();
  if (!(await verifyDiscordSignature(request, rawBody, env))) return new Response("Invalid Discord signature", { status: 401 });
  let interaction;
  try { interaction = JSON.parse(rawBody); } catch (_) { return new Response("Invalid JSON", { status: 400 }); }
  if (interaction.type === 1) return json({ type: 1 }); // Discord endpoint validation PING

  if ((interaction.type === 2 || interaction.type === 3) && (!env.DISCORD_GUILD_ID || String(interaction.guild_id || "") !== String(env.DISCORD_GUILD_ID))) {
    return json({ type: 4, data: { content: "This bot is configured for the groupsimple Discord server only.", flags: 64 } });
  }

  if (interaction.type === 3) {
    // Acknowledge the component immediately; carry out GitHub and Discord API work in the background.
    ctx.waitUntil(handleModerationButton(interaction, env));
    return json({ type: 6 });
  }

  if (interaction.type === 2) {
    // Acknowledge slash commands in time, then send an ephemeral follow-up.
    ctx.waitUntil(runSlashCommand(interaction, env));
    return json({ type: 5, data: { flags: 64 } });
  }

  return json({ type: 4, data: { content: "Unsupported interaction.", flags: 64 } });
}

function optionValue(interaction, name) {
  const options = (interaction.data && interaction.data.options) || [];
  const found = options.find((option) => option.name === name);
  return found ? found.value : undefined;
}

function hasManageGuildPermission(interaction) {
  const permissions = String((interaction.member && interaction.member.permissions) || "0");
  try { return (BigInt(permissions) & 32n) === 32n; } catch (_) { return false; }
}

function interactionIsAdmin(interaction, env) {
  const id = interaction.member && interaction.member.user ? interaction.member.user.id : (interaction.user && interaction.user.id);
  return Boolean(id && (isAdminId(id, env) || hasManageGuildPermission(interaction)));
}

async function handleModerationButton(interaction, env) {
  const customId = String(interaction.data && interaction.data.custom_id || "");
  const parts = customId.split(":");
  const action = parts[0], requestId = parts[1];
  const actor = interaction.member && interaction.member.user ? interaction.member.user : (interaction.user || {});
  const message = interaction.message || {};
  if (!env.DISCORD_CHANNEL_ID || String(interaction.channel_id || "") !== String(env.DISCORD_CHANNEL_ID)) return;
  const embeds = Array.isArray(message.embeds) ? message.embeds : [];
  const originalEmbed = embeds[0] || { title: "groupsimple listing request", fields: [] };
  if (!interactionIsAdmin(interaction, env)) {
    await editInteractionMessage(interaction, env, {
      content: "⛔ You need Manage Server permission or an ID in ADMIN_USER_IDS to moderate listings.",
      embeds,
      components: message.components || []
    });
    return;
  }
  if (!requestId || !["approve", "reject"].includes(action)) return;
  try {
    if (action === "reject") {
      await editInteractionMessage(interaction, env, {
        content: `❌ Listing request rejected by ${discordActor(actor)}.`,
        embeds: [statusEmbed(originalEmbed, 0xb3261e, "Rejected")],
        components: disabledButtons(message.components || [])
      });
      return;
    }

    const fields = Object.fromEntries((originalEmbed.fields || []).map((field) => [field.name.toLowerCase(), field.value]));
    const name = stripField(fields["group name"]);
    const link = stripField(fields["invite link"]);
    const network = stripField(fields["network"]);
    const type = stripField(fields["type"]);
    const description = stripField(fields["description"] === "No description supplied." ? "" : fields["description"]);
    if (!name || !inviteUrlIsAllowed(link) || !NETWORKS.includes(network) || !TYPES.includes(type)) {
      throw new Error("The request embed is missing required listing fields.");
    }
    const groupId = newGroupId(name);
    let pfp = "";
    const attachment = (message.attachments || [])[0];
    if (attachment && attachment.url) {
      const imageResponse = await fetch(attachment.url);
      if (!imageResponse.ok) throw new Error("Could not read the uploaded server image.");
      const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
      if (imageBytes.length > 950000) throw new Error("The server image is too large to store in the GitHub repo.");
      let typeHeader = (attachment.content_type || imageResponse.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
      const ext = typeHeader === "image/jpeg" ? "jpg" : (typeHeader === "image/webp" ? "webp" : "png");
      if (!["image/jpeg", "image/png", "image/webp"].includes(typeHeader)) typeHeader = "image/png";
      const filename = `pfp/${groupId}.${ext}`;
      await githubPut(filename, encodeBytesBase64(imageBytes), `Add server picture for ${name}`, env, null);
      pfp = filename;
    }
    const group = {
      id: groupId,
      name,
      link,
      platform: new URL(link).hostname.toLowerCase().includes("t.me") || new URL(link).hostname.toLowerCase().includes("telegram.me") ? "Telegram" : "Discord",
      network,
      type,
      desc: description,
      pfp,
      added: new Date().toISOString(),
      boostedUntil: null
    };
    await changeGroups(env, `Approve groupsimple listing ${name}`, (groups) => { groups.push(group); return group; });
    await editInteractionMessage(interaction, env, {
      content: `✅ **${discordMarkdown(name)}** approved by ${discordActor(actor)} and added to the website. ${fields["requested placement"] && fields["requested placement"] !== REQUESTS.list ? "Handle any boost payment separately, then use /boost after it is paid." : ""}`,
      embeds: [statusEmbed(originalEmbed, 0x4b7f43, `Approved · server ID ${groupId}`)],
      components: disabledButtons(message.components || [])
    });
  } catch (error) {
    console.error("Moderation button failed:", error && error.stack ? error.stack : error);
    await editInteractionMessage(interaction, env, {
      content: `⚠️ Could not ${action} this request: ${String(error.message || "unknown error").slice(0, 500)}. The buttons remain available for retry.`,
      embeds,
      components: message.components || []
    });
  }
}

function stripField(value) {
  const s = String(value || "").trim();
  return s === "—" ? "" : s;
}

function discordMarkdown(value) {
  return String(value || "").replace(/[\\*_`~|>]/g, "\\$&").slice(0, 100);
}

function discordActor(user) {
  return user && user.username ? `@${String(user.username).slice(0, 80)}` : "a moderator";
}

function statusEmbed(embed, color, footerText) {
  const updated = { ...embed, color };
  if (footerText) updated.footer = { ...(embed.footer || {}), text: footerText.slice(0, 2048) };
  return updated;
}

function disabledButtons(rows) {
  return rows.map((row) => ({
    ...row,
    components: (row.components || []).map((component) => ({ ...component, disabled: true }))
  }));
}

async function editInteractionMessage(interaction, env, payload) {
  if (!interaction.channel_id || !interaction.message || !interaction.message.id) return;
  const response = await discordBotFetch(`${API}/channels/${interaction.channel_id}/messages/${interaction.message.id}`, env, {
    method: "PATCH", body: { ...payload, allowed_mentions: { parse: [] } }
  });
  if (!response.ok) console.error("Could not update moderation message:", response.status, (await response.text().catch(() => "")).slice(0, 300));
}

async function runSlashCommand(interaction, env) {
  try {
    if (!interactionIsAdmin(interaction, env)) {
      await sendFollowup(interaction, env, "⛔ These commands are for moderators. Give the bot your Manage Server permission or add your Discord user ID to ADMIN_USER_IDS.");
      return;
    }
    const name = interaction.data && interaction.data.name;
    const channelId = interaction.channel_id;
    if (name === "groups") {
      const result = await readGroups(env);
      const groups = result.data.groups;
      if (!groups.length) return sendFollowup(interaction, env, "No servers are listed yet.");
      const lines = groups.slice(0, 18).map((g) => {
        const boosted = g.boostedUntil && Date.parse(g.boostedUntil) > Date.now() ? ` · boosted until ${new Date(g.boostedUntil).toISOString().replace("T", " ").slice(0, 16)} UTC` : "";
        return `• **${discordMarkdown(g.name)}** — ID: \`${String(g.id).slice(0, 80)}\` · ${g.network || "?"} · ${g.type || "?"}${boosted}`;
      });
      const extra = groups.length > lines.length ? `\n…and ${groups.length - lines.length} more.` : "";
      return sendFollowup(interaction, env, `**groupsimple servers (${groups.length})**\n${lines.join("\n")}${extra}`.slice(0, 1950));
    }

    if (name === "add") {
      const groupName = String(optionValue(interaction, "name") || "").trim().slice(0, 70);
      const link = String(optionValue(interaction, "link") || "").trim();
      const network = String(optionValue(interaction, "network") || "");
      const type = String(optionValue(interaction, "type") || "");
      const description = String(optionValue(interaction, "description") || "").trim().slice(0, 1000);
      if (!groupName || !inviteUrlIsAllowed(link) || !NETWORKS.includes(network) || !TYPES.includes(type)) {
        return sendFollowup(interaction, env, "Invalid server details. Provide a valid HTTPS Discord/Telegram invite, network, and type.");
      }
      const id = newGroupId(groupName);
      const host = new URL(link).hostname.toLowerCase();
      const group = {
        id, name: groupName, link, platform: host === "t.me" || host === "telegram.me" || host.endsWith(".t.me") ? "Telegram" : "Discord",
        network, type, desc: description, pfp: "", added: new Date().toISOString(), boostedUntil: null
      };
      await changeGroups(env, `Add server ${groupName} from Discord`, (groups) => { groups.push(group); return group; });
      return sendFollowup(interaction, env, `✅ Added **${discordMarkdown(groupName)}** to the website. Server ID: \`${id}\`. Use /post to publish it in a Discord channel.`);
    }

    if (name === "remove") {
      const id = String(optionValue(interaction, "group_id") || "");
      let removed = null;
      await changeGroups(env, `Remove server ${id}`, (groups) => {
        const index = groups.findIndex((g) => String(g.id) === id);
        if (index >= 0) { removed = groups.splice(index, 1)[0]; return removed; }
        return null;
      });
      if (!removed) return sendFollowup(interaction, env, `No server found with ID \`${discordMarkdown(id)}\`.`);
      if (removed.pfp && /^pfp\/[\w.-]+$/.test(removed.pfp)) {
        try { await githubDelete(removed.pfp, `Delete picture for removed server ${removed.name}`, env); }
        catch (error) { console.error("Server removed but pfp cleanup failed:", error.message); }
      }
      return sendFollowup(interaction, env, `🗑️ Removed **${discordMarkdown(removed.name)}** (\`${id}\`) from the website.`);
    }

    if (name === "boost") {
      const id = String(optionValue(interaction, "group_id") || "");
      const days = Number(optionValue(interaction, "days"));
      if (!Number.isInteger(days) || days < 1 || days > 90) return sendFollowup(interaction, env, "Boost days must be a whole number from 1 to 90.");
      let updated = null;
      await changeGroups(env, `Boost server ${id} for ${days} days`, (groups) => {
        const group = groups.find((g) => String(g.id) === id);
        if (!group) return;
        const now = Date.now();
        const start = group.boostedUntil && Date.parse(group.boostedUntil) > now ? Date.parse(group.boostedUntil) : now;
        group.boostedUntil = new Date(start + days * 86400000).toISOString();
        updated = group;
        return group;
      });
      if (!updated) return sendFollowup(interaction, env, `No server found with ID \`${discordMarkdown(id)}\`.`);
      return sendFollowup(interaction, env, `🚀 **${discordMarkdown(updated.name)}** is boosted until ${new Date(updated.boostedUntil).toISOString().replace("T", " ").slice(0, 16)} UTC.`);
    }

    if (name === "unboost") {
      const id = String(optionValue(interaction, "group_id") || "");
      let updated = null;
      await changeGroups(env, `Unboost server ${id}`, (groups) => {
        const group = groups.find((g) => String(g.id) === id);
        if (group) { group.boostedUntil = null; updated = group; return group; }
        return null;
      });
      if (!updated) return sendFollowup(interaction, env, `No server found with ID \`${discordMarkdown(id)}\`.`);
      return sendFollowup(interaction, env, `Boost ended for **${discordMarkdown(updated.name)}**.`);
    }

    if (name === "post") {
      const id = String(optionValue(interaction, "group_id") || "");
      const chosenChannel = optionValue(interaction, "channel");
      const targetChannel = chosenChannel || env.DISCORD_LISTINGS_CHANNEL_ID;
      if (!targetChannel) return sendFollowup(interaction, env, "Set DISCORD_LISTINGS_CHANNEL_ID in Worker variables or pass a target channel to /post.");
      const result = await readGroups(env);
      const group = result.data.groups.find((g) => String(g.id) === id);
      if (!group) return sendFollowup(interaction, env, `No server found with ID \`${discordMarkdown(id)}\`.`);
      const embed = {
        title: String(group.name || "Community").slice(0, 256),
        url: group.link,
        description: String(group.desc || "No description supplied.").slice(0, 4000),
        color: group.boostedUntil && Date.parse(group.boostedUntil) > Date.now() ? 0x4b7f43 : 0x687c63,
        fields: [
          { name: "Network", value: String(group.network || "—"), inline: true },
          { name: "Type", value: String(group.type || "—"), inline: true },
          { name: "Platform", value: String(group.platform || "Discord"), inline: true }
        ],
        footer: { text: `groupsimple · Server ID ${group.id}` }
      };
      if (group.pfp && /^pfp\/[\w.-]+$/.test(group.pfp)) {
        try { embed.thumbnail = { url: new URL(group.pfp, normalizeSiteUrl(env.SITE_URL)).toString() }; } catch (_) {}
      }
      const response = await discordBotFetch(`${API}/channels/${targetChannel}/messages`, env, {
        method: "POST",
        body: { embeds: [embed], components: [{ type: 1, components: [{ type: 2, style: 5, label: "Join server", url: group.link }] }], allowed_mentions: { parse: [] } }
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error("/post failed:", response.status, detail.slice(0, 300));
        return sendFollowup(interaction, env, "Could not post there. Check that the bot can view the target channel and send messages/embed links.");
      }
      return sendFollowup(interaction, env, `✅ Posted **${discordMarkdown(group.name)}** in <#${targetChannel}>.`);
    }

    await sendFollowup(interaction, env, "Unknown command.");
  } catch (error) {
    console.error("Slash command failed:", error && error.stack ? error.stack : error);
    await sendFollowup(interaction, env, `⚠️ Command failed: ${String(error.message || "unexpected error").slice(0, 800)}`);
  }
}

async function sendFollowup(interaction, env, content) {
  if (!interaction.token || !env.DISCORD_APP_ID) return;
  const response = await fetch(`${API}/webhooks/${env.DISCORD_APP_ID}/${interaction.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: String(content).slice(0, 1950), flags: 64, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) console.error("Interaction follow-up failed:", response.status, (await response.text().catch(() => "")).slice(0, 250));
}

function encodeBytesBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function registerCommands(env, cors) {
  required(env, ["DISCORD_APP_ID", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"]);
  const stringOption = (name, description, requiredValue, choices) => ({
    type: 3, name, description, required: requiredValue,
    ...(choices ? { choices: choices.map((value) => ({ name: value, value })) } : {})
  });
  const commands = [
    { name: "groups", description: "List all groupsimple servers and their IDs" },
    { name: "add", description: "Add a server to the groupsimple website", options: [
      stringOption("name", "Server name", true),
      stringOption("link", "HTTPS Discord or Telegram invite link", true),
      stringOption("network", "Main blockchain network", true, NETWORKS),
      stringOption("type", "Server category", true, TYPES),
      stringOption("description", "What members get from this server", false)
    ] },
    { name: "remove", description: "Remove a server from the website", options: [stringOption("group_id", "ID shown by /groups", true)] },
    { name: "boost", description: "Boost a server after payment is confirmed", options: [
      stringOption("group_id", "ID shown by /groups", true),
      { type: 4, name: "days", description: "Number of days to boost (1–90)", required: true, min_value: 1, max_value: 90 }
    ] },
    { name: "unboost", description: "End a server's boost early", options: [stringOption("group_id", "ID shown by /groups", true)] },
    { name: "post", description: "Post a website server listing into a Discord channel", options: [
      stringOption("group_id", "ID shown by /groups", true),
      { type: 7, name: "channel", description: "Optional channel to post in; otherwise uses Worker setting", required: false, channel_types: [0, 5] }
    ] }
  ];
  const response = await fetch(`${API}/applications/${env.DISCORD_APP_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`, {
    method: "PUT",
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(commands)
  });
  const textBody = await response.text();
  if (!response.ok) return json({ error: "Discord command registration failed", status: response.status, details: textBody.slice(0, 1000) }, 502, cors);
  let result = [];
  try { result = JSON.parse(textBody); } catch (_) {}
  return json({ ok: true, registered: result.map((c) => c.name) }, 200, cors);
}
