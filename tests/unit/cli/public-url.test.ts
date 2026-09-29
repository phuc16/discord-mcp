import { describe, expect, it } from 'vitest'
import { publicUrlProblem, redirectUriFor } from '../../../src/cli/public-url.js'

describe('publicUrlProblem', () => {
  it.each(['https://mcp.example.com', 'https://mcp.example.com:8443', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787'])('accepts %s', (v) => {
    expect(publicUrlProblem(v)).toBeNull()
  })
  it('rejects http on a public host, naming the variable and scheme but not the value', () => {
    const m = publicUrlProblem('http://user:secret@mcp.example.com')!
    expect(m).toContain('PUBLIC_BASE_URL')
    expect(m).toContain('http')
    expect(m).toContain('Deploy on an Ubuntu server')
    expect(m).not.toContain('secret')
    expect(m).not.toContain('mcp.example.com')
  })
  it.each(['not a url', 'https://a.example.com/path', 'https://a.example.com/', 'https://a.example.com?x=1', 'https://a.example.com#f', 'ftp://a.example.com'])('rejects %s', (v) => {
    expect(publicUrlProblem(v)).toMatch(/PUBLIC_BASE_URL/)
  })
  it('builds the redirect uri', () => {
    expect(redirectUriFor('https://mcp.example.com')).toBe('https://mcp.example.com/callback')
  })
})
