# Granite Workspace 0.2

## Simple setup

Netlify needs **one setting**: `SITE_PASSWORD`, a unique password with at least
16 characters. Generate a random password and set it for Production only.
Mark it as secret. Keep it out of the source code.
`WORKER_TOKEN` and `SESSION_SECRET` are obsolete and are not used by this version.
Remove obsolete settings if their old values trigger Netlify's secret scanner.
Do not disable secret scanning to bypass an invalid or weak credential.

Deploy the project with its existing `netlify.toml`. Netlify installs dependencies,
runs `npm run build`, publishes `public/`, and bundles `netlify/functions/`.
Open the website and sign in with your workspace password.

On your existing Ubuntu/WSL installation, run:

```bash
curl -fsS https://granitehost.netlify.app/connect.py -o "$HOME/granite-connect.py"
python3 "$HOME/granite-connect.py"
```

Enter the **same workspace password** when asked. The script checks it before
saving it privately, then starts the connection. It asks for no separate token
and no website URL. Later, start it again with:

```bash
python3 "$HOME/granite-connect.py"
```

Keep that terminal open and your computer awake. Ctrl+C stops the connection.
If your website password changes, run the script with `--configure` once.

## Current capabilities

- Live response preview and factual worker status, elapsed time, and received
  character count. Active requests refresh about every three seconds; network
  and storage latency can add delay. This is output streaming, not internal
  reasoning or an operating-system terminal. The live preview is capped at
  30,000 characters; the full response is delivered on completion.
- After deploying this update, wait for any current request to finish, stop the
  old worker with Ctrl+C, and rerun the two download/start commands above.
  Existing saved credentials are reused. Older workers still complete requests
  but cannot provide live progress.

- Saved chat and text-document uploads (TXT, MD, CSV, JSON).
- Discuss or rewrite attached text; download responses as Markdown.
- Password-protected API, signed HttpOnly sessions, bounded requests, and plain-text
  output rendering. No credentials are included in browser JavaScript.
- Your PC collects queued messages over HTTPS and runs `granite4.2:30b` through
  Ollama on `127.0.0.1:11434`. It opens no incoming network port.
- Messages and results survive page refreshes and connection failures.

Ollama must already be running with the model installed. This does not reinstall
or change your existing governed pipeline. PDF/Word editing, EmbeddingGemma
retrieval, and governed PDF generation are not connected yet.

## Limits

This is a personal workspace with one owner and one running worker. The website
and worker use the same owner password. It is not a multi-user permission system.
Chats and uploads are stored in your Netlify project; model generation runs on
your computer. The worker provides no shell/filesystem execution tools to the
model, but it is not an operating-system sandbox.

Text documents: three per message, each under 100 KB and 24,000 characters, with
a combined prompt/attachment limit of 28,000 characters. Model context uses
bounded recent successful turns; the displayed transcript keeps all messages.
The first version has a 2,000-record per-prefix limit and no archive/delete UI.

The worker polls every 10 seconds while running. This uses Netlify function and
storage resources. Stop the worker when not needed or use `--poll-seconds 30`.

## Checks

```bash
npm install
npm test
npm run build
```

The build copies the reviewed worker source to `public/connect.py`. Deploy previews
and other nonproduction deployments use isolated storage. Give secrets only to
trusted deployment contexts. Do not run unreviewed source with production secrets.

Before adding document converters, use isolated processing with explicit file
access, resource limits, and validation/provenance results from the real pipeline.
