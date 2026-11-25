<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

<br />
<div align="center">
  <h3 align="center">discord-mcp</h3>

  <p align="center">
    An MCP server that lets Claude Code, Claude Desktop and other MCP clients manage Discord guilds safely.
    <br />
    <a href="docs/guide.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="docs/getting-started.md">Quick Start</a>
    &middot;
    <a href="https://github.com/phuc16/discord-mcp/issues/new">Report Bug</a>
    &middot;
    <a href="https://github.com/phuc16/discord-mcp/issues/new">Request Feature</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#security">Security</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

discord-mcp runs as **a Discord bot that you own**. Every action goes out as the bot, and live events (joins, messages, role changes) arrive over the bot's gateway connection. It exposes **104 tools** (channels, threads, roles, members, moderation, messages, webhooks, scheduled events, invites, emojis, audit log), live gateway events, and an automation rules engine, all behind one safety pipeline.

The MCP client talks to the server in one of two ways:

- **stdio** (default): the client launches the server as a subprocess. There is no login; what the client may do is decided only by `config.yaml`.
- **HTTP** (`--http`): a long-lived service. Clients log in through OAuth with their Discord account. The login only establishes *who is calling*; the caller's Discord permissions cap what they may do.

Every tool call, including calls made by automation rules, passes one pipeline: input validation, guild allowlist, tier check, bulk rate limit, dry-run confirmation for destructive tools, and an audit row for every outcome. Tiers, from lowest to highest: `read`, `write`, `destructive`.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![TypeScript][TypeScript]][TypeScript-url]
* [![Node.js][Node.js]][Node-url]
* [![Discord.js][Discord.js]][Discord-url]
* [![Express][Express.js]][Express-url]
* [![SQLite][SQLite]][SQLite-url]
* [![Docker][Docker]][Docker-url]

Also: the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk), zod, pino, tsup, Vitest and pnpm.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

To get a local copy up and running, follow these steps. The full walkthrough (including OAuth/HTTP mode and server deployment) is in the [full guide](docs/guide.md).

### Prerequisites

* Node.js 22 or newer
* pnpm
  ```sh
  corepack enable pnpm
  ```
* A Discord account that can create applications and manage the target guild
* Optional: the `claude` CLI (Claude Code) or Claude Desktop as the MCP client

### Installation

1. Create a Discord application and bot in the [Developer Portal](https://discord.com/developers/applications). Copy the **Application ID** (`DISCORD_CLIENT_ID`) and the **bot token** (`DISCORD_BOT_TOKEN`), and enable the **Server Members Intent** (required, otherwise startup fails with `Used disallowed intents`). See [section 3 of the guide](docs/guide.md#3-discord-developer-portal-setup).
2. Clone the repo
   ```sh
   git clone https://github.com/phuc16/discord-mcp.git
   cd discord-mcp
   ```
3. Install packages and build
   ```sh
   pnpm install
   pnpm build
   ```
4. Generate the bot invite URL, open it, and authorise the bot in your guild
   ```sh
   node dist/cli/main.js invite-url --client-id <application id> --permissions manager
   ```
   Then, in Discord, drag the bot's role **above every role it must manage**.
5. Configure `.env` (the bot token) and `config.yaml` (guild allowlist and `max_tier`). See [section 5 of the guide](docs/guide.md#5-configure) and the `config.example.yaml` file.
6. Verify the setup
   ```sh
   node dist/cli/main.js --check --config config.yaml --online
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

**Claude Code (stdio)**

```sh
claude mcp add discord \
  -e DISCORD_BOT_TOKEN=<bot token> \
  -e DISCORD_MCP_CONFIG=/absolute/path/config.yaml \
  -- node /absolute/path/discord-mcp/dist/cli/main.js
```

Then run `/mcp` in Claude Code and try `server_whoami`. Use absolute paths.

Other ways to run it, all covered in the [full guide](docs/guide.md): [Claude Desktop](docs/guide.md#72-claude-desktop-stdio), [HTTP mode with OAuth login](docs/guide.md#73-http-mode-with-oauth-login), [Docker](docs/guide.md#75-run-with-docker), and [deploying on an Ubuntu server](docs/guide.md#76-deploy-on-an-ubuntu-server).

**Ask in plain language; the client picks the tools:**

| Group | Example prompt |
|---|---|
| channels | "Create a text channel called announcements under the Info category", "Make #staff private to the Mods role." |
| roles | "Create a Helper role with a blue colour", "Assign Helper to these 30 users." |
| moderation | "Time out @erin for 10 minutes", "Create an automod rule that blocks invite links." |
| messages | "Post the rules in #welcome", "Pin that message." |
| scheduled_events | "Schedule a movie night Friday 20:00 in the Stage channel." |
| audit_log | "Who deleted channels in the last few days?" |

Destructive tools use a dry-run first and need an explicit confirmation ([details](docs/guide.md#81-destructive-confirmation)). Live events and the automation rules engine are described in [section 9](docs/guide.md#9-events-and-rules), and every tool in the [tool reference](docs/guide.md#10-tool-reference).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Security

- **Secrets** (bot token, client secret, tokens) are excluded from logs. Keep `.env` and `config.yaml` out of version control.
- **Least privilege:** invite with the smallest permission preset you need, list only the guilds you need, and set `max_tier: read` where you only observe. Use `tools.deny` for tools you never want.
- **Guild binding:** an allowlisted `guild_id` cannot be used against a channel, webhook or invite of another guild.
- **OAuth (HTTP mode):** PKCE S256, exact redirect URI matching, single-use `state`, rotating refresh tokens with reuse detection.

Full notes and known limitations are in [section 11 of the guide](docs/guide.md#11-security-notes-and-known-limitations).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Development

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check   # typecheck + lint + tests + build
```

Import boundaries between `src/` modules, and the rule that `discord.js` is imported only inside `src/discord/`, are enforced by eslint. See [section 13 of the guide](docs/guide.md#13-development) for the design docs.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] 104 tools across channels, threads, roles, members, moderation, messages, webhooks, scheduled events, invites, emojis and audit log
- [x] Safety pipeline: allowlist, tiers, bulk rate limit, dry-run confirmation, audit trail
- [x] Live gateway events and an automation rules engine
- [x] HTTP mode with OAuth login, plus Docker and server deployment guides
- [ ] Browser-based cross-origin MCP clients (`OPTIONS /mcp` currently returns 401)

See the [open issues](https://github.com/phuc16/discord-mcp/issues) for proposed features and known issues, and the [known limitations](docs/guide.md#11-security-notes-and-known-limitations).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement". Don't forget to give the project a star!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Run `pnpm check` before opening a pull request.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

No license file has been added to this repository yet, so all rights are reserved by default. Open an issue if you would like to use any part of it.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Phuc Truong Hoang - [@phuc16](https://github.com/phuc16)

Project Link: [https://github.com/phuc16/discord-mcp](https://github.com/phuc16/discord-mcp)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Model Context Protocol](https://modelcontextprotocol.io)
* [discord.js](https://discord.js.org)
* [Shields.io](https://shields.io)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/phuc16/discord-mcp.svg?style=for-the-badge
[contributors-url]: https://github.com/phuc16/discord-mcp/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/phuc16/discord-mcp.svg?style=for-the-badge
[forks-url]: https://github.com/phuc16/discord-mcp/network/members
[stars-shield]: https://img.shields.io/github/stars/phuc16/discord-mcp.svg?style=for-the-badge
[stars-url]: https://github.com/phuc16/discord-mcp/stargazers
[issues-shield]: https://img.shields.io/github/issues/phuc16/discord-mcp.svg?style=for-the-badge
[issues-url]: https://github.com/phuc16/discord-mcp/issues
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Node.js]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/
[Discord.js]: https://img.shields.io/badge/discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white
[Discord-url]: https://discord.js.org/
[Express.js]: https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white
[Express-url]: https://expressjs.com/
[SQLite]: https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white
[SQLite-url]: https://www.sqlite.org/
[Docker]: https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white
[Docker-url]: https://www.docker.com/
