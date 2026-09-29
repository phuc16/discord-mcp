import tseslint from 'typescript-eslint'

const modules = ['contracts', 'discord', 'events', 'safety', 'rules', 'auth', 'store', 'tools', 'server', 'cli']
const allowed = {
  contracts: [],
  tools: ['contracts'],
  rules: ['contracts', 'safety'],
  events: ['contracts', 'store'],
  safety: ['contracts', 'store'],
  auth: ['contracts', 'store'],
  discord: ['contracts'],
  store: ['contracts'],
}

const discordJs = { name: 'discord.js', message: 'discord.js may only be imported inside src/discord/' }

const boundaryConfigs = Object.entries(allowed).map(([mod, ok]) => ({
  files: [`src/${mod}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: mod === 'discord' ? [] : [discordJs],
        patterns: modules
          .filter((m) => m !== mod && !ok.includes(m))
          .map((m) => ({ group: [`**/${m}`, `**/${m}/**`], message: `src/${mod} must not import src/${m}` })),
      },
    ],
  },
}))

const looseConfigs = ['server', 'cli'].map((mod) => ({
  files: [`src/${mod}/**/*.ts`],
  rules: { 'no-restricted-imports': ['error', { paths: [discordJs] }] },
}))

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  ...tseslint.configs.recommended,
  ...boundaryConfigs,
  ...looseConfigs,
)
