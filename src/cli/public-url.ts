const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

const FIX = 'use an https URL served through a TLS reverse proxy (see README: Deploy on an Ubuntu server)'

export const publicUrlProblem = (value: string): string | null => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `PUBLIC_BASE_URL is not a valid URL: ${FIX}`
  }
  const scheme = url.protocol.replace(':', '')
  if (scheme !== 'https' && !(scheme === 'http' && LOOPBACK.has(url.hostname))) {
    return `PUBLIC_BASE_URL uses scheme "${scheme}" but must be https unless the host is localhost, 127.0.0.1 or [::1]: ${FIX}`
  }
  if (value.endsWith('/') || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return 'PUBLIC_BASE_URL must be just the origin, for example https://mcp.example.com: no path, query, fragment or trailing slash'
  }
  return null
}

export const redirectUriFor = (publicBaseUrl: string): string => `${publicBaseUrl}/callback`
