const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)

const CLIENT_NAME_MAX = 100

const displayName = (raw: string): string => {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').trim()
  const shown = cleaned.length > CLIENT_NAME_MAX ? `${cleaned.slice(0, CLIENT_NAME_MAX)}…` : cleaned
  return shown.length > 0 ? shown : 'An unnamed application'
}

export interface ConsentPage {
  clientName: string
  redirectUri: string
  csrf: string
  fields: Record<string, string>
}

const hidden = (fields: Record<string, string>, csrf: string): string =>
  [...Object.entries(fields), ['csrf', csrf] as const]
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('\n      ')

export const renderConsentPage = (p: ConsentPage): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Authorize access</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  code { word-break: break-all; background: #eee; padding: 0.1rem 0.3rem; }
  button { font-size: 1rem; padding: 0.5rem 1.2rem; margin-right: 0.5rem; }
</style>
</head>
<body>
  <h1>Authorize access</h1>
  <p><strong>${escapeHtml(displayName(p.clientName))}</strong> wants to manage your Discord servers through this discord-mcp server.</p>
  <p>After you approve, you will be sent to Discord to sign in, then returned to:</p>
  <p><code>${escapeHtml(p.redirectUri)}</code></p>
  <p>Only approve if you started this connection and recognise that address.</p>
  <form method="post" action="/authorize">
      ${hidden(p.fields, p.csrf)}
      <button type="submit" name="consent" value="approve">Approve</button>
      <button type="submit" name="consent" value="deny">Deny</button>
  </form>
</body>
</html>
`
