import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from '../../../src/contracts/index.js'
import { renderTemplate, templateReferences } from '../../../src/rules/template.js'

const e: NormalizedEvent = { id: 9, guildId: '111111111111111111', type: 'member_join', at: 'now', data: { user_id: '42', n: 3, nested: { k: 'v' } } }

describe('renderTemplate', () => {
  it('substitutes event.data and event fields', () => {
    expect(renderTemplate({ guild_id: '{{event.guild_id}}', user_id: '{{event.data.user_id}}' }, e)).toEqual({
      guild_id: '111111111111111111',
      user_id: '42',
    })
  })

  it('keeps types for whole-string placeholders and interpolates within text', () => {
    expect(renderTemplate({ n: '{{event.data.n}}', text: 'hi <@{{event.data.user_id}}> #{{ event.data.n }}' }, e)).toEqual({
      n: 3,
      text: 'hi <@42> #3',
    })
  })

  it('walks nested objects and arrays', () => {
    expect(renderTemplate({ a: { b: ['{{event.data.nested.k}}', 1] } }, e)).toEqual({ a: { b: ['v', 1] } })
  })

  it('missing key throws', () => {
    expect(() => renderTemplate({ x: '{{event.data.nope}}' }, e)).toThrow('template: missing event.data.nope')
  })

  it('rejects non-event references', () => {
    expect(() => renderTemplate({ x: '{{process.env.HOME}}' }, e)).toThrow('template: missing process.env.HOME')
  })

  it('does not traverse prototypes', () => {
    expect(() => renderTemplate({ x: '{{event.data.constructor}}' }, e)).toThrow('template: missing')
  })
})

describe('templateReferences', () => {
  it('lists placeholder paths', () => {
    expect(templateReferences({ a: '{{event.data.x}} {{ other.y }}', b: [{ c: '{{event.guild_id}}' }] })).toEqual([
      'event.data.x',
      'other.y',
      'event.guild_id',
    ])
  })
})
