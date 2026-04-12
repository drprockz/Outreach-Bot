# Vertex AI Setup Guide

Switching Radar from Gemini API key → Vertex AI ($300 free credit).

---

## Local Development (Application Default Credentials)

### 1. Fix gcloud PATH (one-time)

`brew install google-cloud-sdk` installs the CLI but doesn't add it to PATH automatically.

```bash
# Add to current shell session
source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"

# Make permanent
echo 'source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"' >> ~/.zshrc
```

### 2. Authenticate

```bash
gcloud auth login
```

### 3. Set your project

```bash
gcloud config set project YOUR_PROJECT_ID
```

Create a project at [console.cloud.google.com](https://console.cloud.google.com) if needed. Billing must be enabled to use Vertex AI (the $300 credit covers this).

### 4. Enable Vertex AI API

```bash
gcloud services enable aiplatform.googleapis.com
```

### 5. Set Application Default Credentials

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

### 6. Update .env

Remove `GEMINI_API_KEY` and add:

```env
VERTEX_PROJECT=your-project-id
VERTEX_LOCATION=us-central1
```

---

## VPS Deployment (Service Account JSON Key)

### 1. Create a Service Account

In GCP Console: **IAM & Admin → Service Accounts → Create Service Account**

- Name: `radar-vertex`
- Role: `Vertex AI User`
- Click **Create Key → JSON** → download the file

### 2. Upload key to VPS

```bash
scp key.json radar@your-vps-ip:/home/radar/gcp-key.json
chmod 600 /home/radar/gcp-key.json
```

### 3. Update VPS .env

```env
GOOGLE_APPLICATION_CREDENTIALS=/home/radar/gcp-key.json
VERTEX_PROJECT=your-project-id
VERTEX_LOCATION=us-central1
```

Remove `GEMINI_API_KEY` from VPS `.env`.

### 4. Restart PM2

```bash
pm2 restart all
```

---

## Code Change (utils/gemini.js)

After auth is set up, update `utils/gemini.js` to use the Vertex AI SDK.
This has NOT been done yet — do it after local auth is confirmed working.

```bash
npm install @google-cloud/vertexai
```

The `callGemini()` function signature stays identical — only the client internals change.

---

## Pricing Reference

Gemini 2.5 Flash on Vertex AI (same model, same pricing):
- Input: $0.30 / 1M tokens
- Output: $2.50 / 1M tokens

$300 free credit = ~400 days of current usage (~$0.75/day).
