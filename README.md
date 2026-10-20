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
  and storage latency can add delay. This is output streaming, not an
  operating-system terminal. The live answer preview is capped at
  30,000 characters; the full response is delivered on completion.
- Chat requests enable Ollama thinking and show its actual `message.thinking`
  stream in an expandable Thinking panel, separate from the answer. The live
  trace displays up to 30,000 characters; up to 60,000 are saved with the result
  (including failed requests), with an explicit notice if clipped. Saved
  thinking is not fed back into subsequent chat context. No trace is invented
  if the model emits none. Thinking uses the same three-second polling cadence.
  The chat generation budget is 8,192 tokens including reasoning and the answer.
  PDF generation still uses the existing pipeline, which disables thinking and
  exposes production stages only.
- After deploying this update, wait for any current request to finish, stop the
  old worker with Ctrl+C, and rerun the two download/start commands above.
  Existing saved credentials are reused. Older workers still complete requests
  but cannot provide live progress.

- Saved chat and document uploads (PDF, TXT, MD, CSV, JSON).
- Read embedded PDF text with page labels. Choose **Create PDF** beside Send
  to create a document or rewrite an attached PDF into a new downloadable PDF.
  Originals are preserved. Scans need OCR first; images, charts, original layout,
  interactive fields and digital signatures are not reproduced by text rewriting.
- Discuss or rewrite attached text; download responses as Markdown.
- Password-protected API, signed HttpOnly sessions, bounded requests, and plain-text
  output rendering. No credentials are included in browser JavaScript.
- Your PC collects queued messages over HTTPS and runs `granite4.2:30b` through
  Ollama on `127.0.0.1:11434`. It opens no incoming network port.
- Messages and results survive page refreshes and connection failures.

Ollama must already be running with the model installed. This does not reinstall
or change your existing governed pipeline. PDF production calls the existing
`~/granite-governed-pipeline/bin/run-document` in WSL (override its location using
the local `GRANITE_ROOT` environment variable). Word editing and EmbeddingGemma
retrieval are not connected to the website.

PDF reading requires `pdfinfo`, `pdftotext` (poppler-utils), and `prlimit`
(util-linux). The existing governed pipeline must already work for PDF writing.
Its governance refresh, generation, two compilation passes, font audit and
PDF/UA-2 + WTPDF checks run unchanged. The worker additionally checks the passing
result, both validation reports and evidence hashes before exposing a download.
Manual accessibility and visual review are still required. Failed runs remain
in the pipeline's `runs/` directory for local diagnosis; raw logs stay off the site.
PDF generation has a 30-minute timeout and uses the pipeline's own model settings
and context window; large source documents should be split into smaller tasks.

## Limits

This is a personal workspace with one owner and one running worker. The website
and worker use the same owner password. It is not a multi-user permission system.
Chats and uploads are stored in your Netlify project; model generation runs on
your computer. The worker provides no shell/filesystem execution tools to the
model, but it is not an operating-system sandbox.

Text documents: three per message, each under 100 KB and 24,000 characters, with
a combined prompt/attachment limit of 28,000 characters. Model context uses
bounded recent successful turns; the displayed transcript keeps all messages.
PDFs: under 2 MB each, at most 80 pages and 60,000 extracted characters each.
PDF extraction runs with process memory, CPU, file-size and time limits. Requests
with PDFs are bounded to 90,000 characters for the current message plus a bounded
history. Oversized extraction is rejected, never silently truncated. Downloads
are capped at 2 MB and require the signed-in workspace session.
PDF jobs wait for the updated worker; an old worker cannot process them.
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
