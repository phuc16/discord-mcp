import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()

async function messages(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result?.messages.map((m) => m.ruleId) ?? []
}

describe('import boundaries', () => {
  it('rejects tools importing discord', async () => {
    const ids = await messages('src/tools/x.ts', "import { a } from '../discord/index.js'\nexport const b = a\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('rejects tools importing store', async () => {
    const ids = await messages('src/tools/x.ts', "import { a } from '../store/index.js'\nexport const b = a\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('rejects discord.js outside src/discord', async () => {
    const ids = await messages('src/safety/x.ts', "import { Client } from 'discord.js'\nexport const c = Client\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('allows discord.js inside src/discord', async () => {
    const ids = await messages('src/discord/x.ts', "import { Client } from 'discord.js'\nexport const c = Client\n")
    expect(ids).not.toContain('no-restricted-imports')
  })
  it('allows auth importing the mcp sdk server paths', async () => {
    const ids = await messages('src/auth/x.ts', "import { a } from '@modelcontextprotocol/sdk/server/auth/clients.js'\nexport const b = a\n")
    expect(ids).not.toContain('no-restricted-imports')
  })
  it('rejects auth importing server', async () => {
    const ids = await messages('src/auth/x.ts', "import { a } from '../server/index.js'\nexport const b = a\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('allows tools importing contracts', async () => {
    const ids = await messages('src/tools/x.ts', "import { a } from '../contracts/index.js'\nexport const b = a\n")
    expect(ids).not.toContain('no-restricted-imports')
  })
})
