# 📱 YouTube Shorts Auto-Uploader v2.0

A production-ready Node.js web app to upload and schedule YouTube Shorts to multiple channels automatically.

---

## 📁 Project Structure

```
yt-shorts-uploader/
├── server.js           ← Express backend (all API routes + YouTube logic)
├── package.json
├── tokens.json         ← OAuth token store (auto-managed, one key per channel)
├── .env                ← Your secrets (create from .env.example)
├── .env.example        ← Template with setup instructions
├── .gitignore
├── uploads/            ← Temp video storage during upload (auto-created)
└── public/
    └── index.html      ← Single-file frontend UI
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure credentials
```bash
cp .env.example .env
# Open .env and paste your Google CLIENT_ID and CLIENT_SECRET
```

### 3. Set up Google Cloud (one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. **Create a project** (or select an existing one)
3. Enable **YouTube Data API v3**
   - APIs & Services → Library → search "YouTube Data API v3" → Enable
4. Create **OAuth 2.0 credentials**
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth2callback`
   - Copy the **Client ID** and **Client Secret** → paste into `.env`
5. Configure **OAuth consent screen**
   - APIs & Services → OAuth consent screen
   - Add your Google account as a **Test User** (required while app is in testing)

### 4. Run the server
```bash
# Production
npm start

# Development (auto-restart on save)
npm run dev
```

### 5. Open the app
```
http://localhost:3000
```

---

## 🔌 Connecting Channels

1. Click **"Add channel"** in the UI
2. Enter a nickname (e.g. `main`, `gaming`, `brand`)
3. You'll be redirected to Google's consent screen
4. Approve access — tokens are saved to `tokens.json`
5. Repeat for each channel you want to manage

---

## 📤 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/` | Frontend UI |
| `GET`  | `/channels` | List connected channels |
| `GET`  | `/auth/:channelName` | Start OAuth for a channel |
| `GET`  | `/oauth2callback` | OAuth callback (Google redirects here) |
| `POST` | `/upload-short` | Upload a Short (multipart/form-data) |
| `DELETE` | `/channels/:channelName` | Disconnect a channel |

### POST /upload-short fields
| Field | Type | Description |
|-------|------|-------------|
| `video` | File | Video file (mp4, mov, avi, webm — max 500MB) |
| `title` | String | Video title (`#Shorts` is appended automatically) |
| `channelName` | String | Connected channel name |

### Example with curl
```bash
curl -X POST http://localhost:3000/upload-short \
  -F "video=@/path/to/clip.mp4" \
  -F "title=This is wild" \
  -F "channelName=my-channel"
```

---

## ⚙️ Fixed Upload Settings

| Setting | Value |
|---------|-------|
| Title suffix | ` #Shorts` (auto-appended) |
| Description | `Subscribe for daily viral shorts` |
| Tags | `shorts, viral, ytshorts, trend` |
| Privacy | `private` → auto-publishes at 17:30 |
| Publish time | Today at **17:30 server local time** |

> If 17:30 has already passed when you upload, it schedules for the next day.

---

## 🔒 Security Notes

- **Never commit `.env` or `tokens.json`** — both are in `.gitignore`
- Tokens auto-refresh silently; refreshed tokens are saved back to `tokens.json`
- If a token is revoked, re-authenticate by visiting `/auth/:channelName`

---

## 🛠 Troubleshooting

| Problem | Fix |
|---------|-----|
| "Missing CLIENT_ID" on startup | Create `.env` from `.env.example` and add credentials |
| "Channel not connected" | Visit `/auth/<channelName>` in your browser |
| "Token expired / revoked" | Re-visit `/auth/<channelName>` |
| Upload fails with 403 | Ensure YouTube Data API v3 is enabled in Cloud Console |
| Google error "access_denied" | Add your account as a Test User in OAuth consent screen |
| No `refresh_token` saved | Delete the channel entry from `tokens.json` and re-auth |
