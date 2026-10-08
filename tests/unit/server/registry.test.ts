import { describe, expect, it } from 'vitest'
import { buildToolRegistry } from '../../../src/server/registry.js'
import { fakeTool } from './helpers.js'

describe('buildToolRegistry', () => {
  it('adds confirm_token to destructive tools only', () => {
    const reg = buildToolRegistry([fakeTool('a_read', 'read'), fakeTool('b_del', 'destructive')], [])
    expect(reg.get('a_read')!.input.shape).not.toHaveProperty('confirm_token')
    expect(reg.get('b_del')!.input.shape).toHaveProperty('confirm_token')
  })
  it('rejects duplicate names', () => {
    expect(() => buildToolRegistry([fakeTool('a', 'read'), fakeTool('a', 'write')], [])).toThrow(/duplicate/)
  })
  it('excludes denied tools', () => {
    const reg = buildToolRegistry([fakeTool('a', 'read'), fakeTool('b', 'write')], ['b'])
    expect([...reg.keys()]).toEqual(['a'])
  })
})
