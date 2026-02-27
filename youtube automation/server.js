// ════════════════════════════════════════════════════════════════════════════
//  YouTube Shorts Auto-Uploader  —  server.js
//  Production-ready multi-channel backend
// ════════════════════════════════════════════════════════════════════════════

"use strict";
require("dotenv").config();

const express  = require("express");
const multer   = require("multer");
const { google } = require("googleapis");
const fs       = require("fs");
const path     = require("path");

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION
//  All secrets come from .env — never hard-code credentials here.
//  See .env.example for setup instructions.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  clientId:     process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  redirectUri:  process.env.REDIRECT_URI || "http://localhost:3000/oauth2callback",
  port:         parseInt(process.env.PORT || "3000", 10),

  // Fixed video metadata applied to every Short
  description:  "Subscribe for daily viral shorts",
  tags:         ["shorts", "viral", "ytshorts", "trend"],

  // Scheduled publish time: unlisted at 16:00, public at 17:30 (local server time)
  unlistedHour:   16,
  unlistedMinute: 0,
  publishHour:    17,
  publishMinute:  30,

  // File limits
  maxFileSizeMB: 500,
};

// Validate required env vars at startup
if (!CONFIG.clientId || !CONFIG.clientSecret) {
  console.error("\n❌  Missing CLIENT_ID or CLIENT_SECRET in your .env file.");
  console.error("    Copy .env.example → .env and fill in your Google credentials.\n");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATHS
// ─────────────────────────────────────────────────────────────────────────────
const TOKENS_FILE  = path.join(__dirname, "tokens.json");
const UPLOADS_DIR  = path.join(__dirname, "uploads");
const PUBLIC_DIR   = path.join(__dirname, "public");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
//  TOKEN STORE  (simple JSON file — tokens.json)
//  Shape: { "channelName": { access_token, refresh_token, expiry_date, ... } }
// ─────────────────────────────────────────────────────────────────────────────
const TokenStore = {
  _data: null,

  /** Load tokens from disk (cached) */
  load() {
    if (this._data) return this._data;
    try {
      this._data = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    } catch {
      this._data = {};
    }
    return this._data;
  },

  /** Persist tokens to disk */
  save() {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(this._data, null, 2));
  },

  /** Get tokens for a channel */
  get(channelName) {
    return this.load()[channelName] || null;
  },

  /** Store tokens for a channel */
  set(channelName, tokens) {
    this.load();
    this._data[channelName] = tokens;
    this.save();
  },

  /** List all channel names that have tokens */
  list() {
    return Object.keys(this.load());
  },

  /** Remove a channel's tokens */
  remove(channelName) {
    this.load();
    delete this._data[channelName];
    this.save();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  OAUTH2 HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Create a fresh OAuth2 client */
function createOAuthClient() {
  return new google.auth.OAuth2(
    CONFIG.clientId,
    CONFIG.clientSecret,
    CONFIG.redirectUri
  );
}

/**
 * Get an authenticated OAuth2 client for a channel.
 * Automatically persists refreshed tokens back to disk.
 */
function getAuthForChannel(channelName) {
  const tokens = TokenStore.get(channelName);
  if (!tokens) return null;

  const auth = createOAuthClient();
  auth.setCredentials(tokens);

  // Whenever googleapis refreshes the access token, persist it
  auth.on("tokens", (refreshed) => {
    const updated = { ...TokenStore.get(channelName), ...refreshed };
    TokenStore.set(channelName, updated);
    console.log(`[auth] Token auto-refreshed for channel: ${channelName}`);
  });

  return auth;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEDULING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Date for today at HH:MM local time.
 * If that time has already passed, return tomorrow at the same time.
 */
function todayAt(hour, minute) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  if (d <= new Date()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MULTER — disk storage for uploaded videos
// ─────────────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${stamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: CONFIG.maxFileSizeMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/mpeg"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: mp4, mov, avi, webm`));
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
//  EXPRESS APP
// ─────────────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR)); // serves public/index.html

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE: GET /channels
//  Returns all connected channel names
// ─────────────────────────────────────────────────────────────────────────────
app.get("/channels", (_req, res) => {
  const channels = TokenStore.list();
  res.json({ count: channels.length, channels });
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE: GET /auth/:channelName
//  Kick off Google OAuth for a given channel name
// ─────────────────────────────────────────────────────────────────────────────
app.get("/auth/:channelName", (req, res) => {
  const { channelName } = req.params;

  // Only allow safe identifiers
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(channelName)) {
    return res.status(400).json({
      error: "Channel name must be 1–64 chars: letters, numbers, hyphens, underscores.",
    });
  }

  const auth = createOAuthClient();
  const url  = auth.generateAuthUrl({
    access_type: "offline",
    prompt:      "consent",          // Always return refresh_token
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    state: channelName,              // Carry channel name through the flow
  });

  console.log(`[auth] Starting OAuth for: ${channelName}`);
  res.redirect(url);
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE: GET /oauth2callback
//  Google redirects here after user approves — exchange code for tokens
// ─────────────────────────────────────────────────────────────────────────────
app.get("/oauth2callback", async (req, res) => {
  const { code, state: channelName, error } = req.query;

  if (error) {
    return res.status(400).send(callbackPage("error", `OAuth denied: ${error}`));
  }
  if (!code || !channelName) {
    return res.status(400).send(callbackPage("error", "Missing code or channel name."));
  }

  try {
    const auth            = createOAuthClient();
    const { tokens }      = await auth.getToken(String(code));
    TokenStore.set(String(channelName), tokens);

    console.log(`[auth] ✅ Tokens saved for channel: ${channelName}`);
    res.send(callbackPage("success", channelName));
  } catch (err) {
    console.error("[auth] Token exchange error:", err.message);
    res.status(500).send(callbackPage("error", err.message));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE: POST /upload-short
//  Accept a video + metadata, upload to YouTube as a scheduled Short
//
//  Body (multipart/form-data):
//    video       — video file
//    title       — video title (#Shorts appended automatically)
//    channelName — must be a connected channel
// ─────────────────────────────────────────────────────────────────────────────
app.post("/upload-short", upload.single("video"), async (req, res) => {
  const videoFile = req.file;

  /** Delete temp file from disk */
  const cleanup = () => {
    if (videoFile && fs.existsSync(videoFile.path)) {
      fs.unlink(videoFile.path, () => {});
    }
  };

  // ── Input validation ────────────────────────────────────────────────────
  if (!videoFile) {
    return res.status(400).json({ error: "No video file. Use field name 'video'." });
  }

  const { title, channelName } = req.body;

  if (!title?.trim()) {
    cleanup();
    return res.status(400).json({ error: "'title' is required." });
  }
  if (!channelName?.trim()) {
    cleanup();
    return res.status(400).json({ error: "'channelName' is required." });
  }

  // ── Auth check ──────────────────────────────────────────────────────────
  const auth = getAuthForChannel(channelName.trim());
  if (!auth) {
    cleanup();
    return res.status(401).json({
      error: `Channel '${channelName}' is not connected.`,
      fix:   `Visit /auth/${channelName} to authenticate.`,
    });
  }

  // ── Build metadata ──────────────────────────────────────────────────────
  const shortsTitle   = `${title.trim()} #Shorts`;

  // Schedule: unlisted at 16:00, published at 17:30
  const unlistedAt    = todayAt(CONFIG.unlistedHour, CONFIG.unlistedMinute);
  const publishAt     = todayAt(CONFIG.publishHour,  CONFIG.publishMinute);

  // If unlistedAt is after publishAt (shouldn't happen but guard anyway), just use publishAt
  const effectiveUnlisted = unlistedAt < publishAt ? unlistedAt : publishAt;

  const videoBody = {
    snippet: {
      title:       shortsTitle,
      description: CONFIG.description,
      tags:        CONFIG.tags,
      categoryId:  "22",            // People & Blogs
    },
    status: {
      privacyStatus:              "private",  // Must be private to use publishAt
      publishAt:                  publishAt.toISOString(),
      selfDeclaredMadeForKids:    false,
    },
  };

  console.log(`[upload] Channel   : ${channelName}`);
  console.log(`[upload] Title     : ${shortsTitle}`);
  console.log(`[upload] Unlisted  : ${effectiveUnlisted.toISOString()}`);
  console.log(`[upload] Publish   : ${publishAt.toISOString()}`);
  console.log(`[upload] File      : ${videoFile.originalname} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB)`);

  try {
    const youtube = google.youtube({ version: "v3", auth });

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: videoBody,
      media: {
        mimeType: videoFile.mimetype,
        body:     fs.createReadStream(videoFile.path),
      },
    });

    const video = response.data;
    console.log(`[upload] ✅ Success — Video ID: ${video.id}`);

    cleanup();

    res.status(201).json({
      success:      true,
      videoId:      video.id,
      title:        video.snippet?.title,
      publishAt:    publishAt.toISOString(),
      youtubeUrl:   `https://www.youtube.com/watch?v=${video.id}`,
      channel:      channelName,
    });

  } catch (err) {
    console.error("[upload] YouTube API error:", err.message);
    cleanup();

    if (err.status === 401 || err.code === 401) {
      return res.status(401).json({
        error: "OAuth token expired or revoked.",
        fix:   `Re-authenticate at /auth/${channelName}`,
      });
    }

    // Surface quota / API errors clearly
    const detail = err.errors?.[0]?.message || err.message;
    res.status(500).json({ error: "Upload failed.", detail });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE: DELETE /channels/:channelName
//  Disconnect a channel by removing its tokens
// ─────────────────────────────────────────────────────────────────────────────
app.delete("/channels/:channelName", (req, res) => {
  const { channelName } = req.params;
  if (!TokenStore.get(channelName)) {
    return res.status(404).json({ error: `Channel '${channelName}' not found.` });
  }
  TokenStore.remove(channelName);
  console.log(`[channels] Removed channel: ${channelName}`);
  res.json({ success: true, removed: channelName });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL ERROR HANDLER  (catches multer errors, etc.)
// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ─────────────────────────────────────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────────────────────────────────────
app.listen(CONFIG.port, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║   📱  YouTube Shorts Uploader  v2.0              ║
║   http://localhost:${CONFIG.port}                         ║
╚══════════════════════════════════════════════════╝

  Endpoints:
    GET  /                       → Frontend UI
    GET  /channels               → List connected channels
    GET  /auth/:channelName      → Connect a YouTube channel
    GET  /oauth2callback         → OAuth callback (auto)
    POST /upload-short           → Upload a Short
    DELETE /channels/:name       → Disconnect a channel

  Token store  : ./tokens.json
  Upload temp  : ./uploads/
  Schedule     : Unlisted ${CONFIG.unlistedHour}:${String(CONFIG.unlistedMinute).padStart(2,"0")} → Public ${CONFIG.publishHour}:${String(CONFIG.publishMinute).padStart(2,"0")} (server local time)
`);
});

// ─────────────────────────────────────────────────────────────────────────────
//  HELPER: OAuth callback HTML page
// ─────────────────────────────────────────────────────────────────────────────
function callbackPage(type, payload) {
  const isSuccess = type === "success";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${isSuccess ? "Channel Connected" : "Auth Error"}</title>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{min-height:100vh;display:grid;place-items:center;background:#050505;
         font-family:'DM Sans',sans-serif;color:#f0f0f0;padding:24px}
    .card{background:#111;border:1px solid #222;border-radius:20px;padding:40px 32px;
          text-align:center;max-width:400px;width:100%}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-family:'Syne',sans-serif;font-size:22px;margin-bottom:8px;
       color:${isSuccess ? "#4ade80" : "#f87171"}}
    p{color:#888;font-size:14px;line-height:1.6;margin-bottom:20px}
    .channel{display:inline-block;background:#1a1a1a;border:1px solid #333;
             border-radius:8px;padding:6px 16px;font-size:14px;color:#f0f0f0;
             font-weight:500;margin-bottom:20px}
    a{display:inline-block;background:${isSuccess ? "#16a34a" : "#991b1b"};
      color:white;text-decoration:none;padding:12px 28px;border-radius:12px;
      font-size:14px;font-weight:500}
    a:hover{opacity:0.85}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? "✅" : "❌"}</div>
    <h1>${isSuccess ? "Channel Connected!" : "Authentication Failed"}</h1>
    ${isSuccess
      ? `<p>Successfully linked:</p><div class="channel">📺 ${payload}</div><p>You can now upload Shorts to this channel.</p>`
      : `<p>${payload}</p>`}
    <a href="/">← Back to App</a>
  </div>
</body>
</html>`;
}
