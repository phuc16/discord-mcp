import { describe, expect, it } from 'vitest'
import { roleMemberMethods } from '../../../src/discord/port-roles-members.js'
import { type Call, recordingRest } from './helpers.js'

const setup = () => {
  const calls: Call[] = []
  return { calls, m: roleMemberMethods(recordingRest(calls, {})) }
}

describe('role and member methods', () => {
  it('listRoles', async () => {
    const { calls, m } = setup()
    await m.listRoles('1')
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/roles' }])
  })

  it('createRole / updateRole / deleteRole', async () => {
    const { calls, m } = setup()
    await m.createRole('1', { name: 'r' }, 'why')
    await m.updateRole('1', '2', { name: 's' }, 'why')
    await m.deleteRole('1', '2', 'why')
    expect(calls).toEqual([
      { verb: 'post', route: '/guilds/1/roles', body: { name: 'r' }, reason: 'why' },
      { verb: 'patch', route: '/guilds/1/roles/2', body: { name: 's' }, reason: 'why' },
      { verb: 'delete', route: '/guilds/1/roles/2', reason: 'why' },
    ])
  })

  it('reorderRoles sends array', async () => {
    const { calls, m } = setup()
    const positions = [{ id: '2', position: 3 }]
    await m.reorderRoles('1', positions)
    expect(calls).toEqual([{ verb: 'patch', route: '/guilds/1/roles', body: positions }])
  })

  it('listMembers / getMember', async () => {
    const { calls, m } = setup()
    await m.listMembers('1', { limit: 50, after: '7' })
    await m.getMember('1', '2')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/members', query: { limit: 50, after: '7' } },
      { verb: 'get', route: '/guilds/1/members/2' },
    ])
  })

  it('searchMembers', async () => {
    const { calls, m } = setup()
    await m.searchMembers('1', 'ann', 10)
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/members/search', query: { query: 'ann', limit: 10 } }])
  })

  it('updateMember', async () => {
    const { calls, m } = setup()
    await m.updateMember('1', '2', { nick: 'n' }, 'why')
    expect(calls).toEqual([{ verb: 'patch', route: '/guilds/1/members/2', body: { nick: 'n' }, reason: 'why' }])
  })

  it('addMemberRole / removeMemberRole', async () => {
    const { calls, m } = setup()
    await m.addMemberRole('1', '2', '3', 'why')
    await m.removeMemberRole('1', '2', '3', 'why')
    expect(calls).toEqual([
      { verb: 'put', route: '/guilds/1/members/2/roles/3', reason: 'why' },
      { verb: 'delete', route: '/guilds/1/members/2/roles/3', reason: 'why' },
    ])
  })
})
