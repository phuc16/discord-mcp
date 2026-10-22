# discord-mcp

[English](README.md) | **Tiếng Việt**

MCP server cho phép Claude Code, Claude Desktop và các MCP client khác quản lý server Discord (guild). Cung cấp 104 tool (channel, thread, role, member, moderation, message, webhook, scheduled event, invite, emoji, audit log), sự kiện gateway theo thời gian thực và một engine automation rules, tất cả đi qua một pipeline an toàn duy nhất.

README này là hướng dẫn đầy đủ. Bản ngắn xem [docs/getting-started.md](docs/getting-started.md); kiểm tra thủ công xem [docs/smoke-checklist.md](docs/smoke-checklist.md).

## Mục lục

1. [Là gì và hoạt động thế nào](#1-là-gì-và-hoạt-động-thế-nào)
2. [Yêu cầu](#2-yêu-cầu)
3. [Thiết lập Discord Developer Portal](#3-thiết-lập-discord-developer-portal)
4. [Cài đặt và build](#4-cài-đặt-và-build)
5. [Cấu hình](#5-cấu-hình)
6. [Kiểm tra](#6-kiểm-tra)
7. [Sử dụng](#7-sử-dụng)
8. [Dùng các tool](#8-dùng-các-tool)
9. [Events và rules](#9-events-và-rules)
10. [Danh sách tool](#10-danh-sách-tool)
11. [Lưu ý bảo mật và giới hạn](#11-lưu-ý-bảo-mật-và-giới-hạn)
12. [Xử lý sự cố](#12-xử-lý-sự-cố)
13. [Phát triển](#13-phát-triển)

## 1. Là gì và hoạt động thế nào

discord-mcp chạy như **một Discord bot do bạn sở hữu**. Mọi hành động đều được gửi đi dưới danh nghĩa bot, và sự kiện trực tiếp (join, tin nhắn, đổi role) đến qua kết nối gateway của bot. Vì vậy luôn cần một danh tính bot.

MCP client kết nối với server theo một trong hai cách:

- **stdio** (mặc định): client khởi chạy server như một tiến trình con. Không có đăng nhập. Client được làm gì chỉ do `config.yaml` quyết định.
- **HTTP** (`--http`): server là một dịch vụ chạy lâu dài. Client đăng nhập qua OAuth bằng tài khoản Discord. Đăng nhập chỉ xác định *ai đang gọi*; server không bao giờ hành động với tư cách người dùng đó. Quyền Discord của người gọi giới hạn những gì họ được làm (Administrator có mọi thứ mà config cho phép; người chỉ có Manage Server bị giới hạn thấp hơn).

Mọi lần gọi tool, kể cả do automation rule thực hiện, đều đi qua một pipeline: kiểm tra input, allowlist guild, kiểm tra tier, giới hạn tốc độ bulk, xác nhận dry-run cho tool destructive, và một dòng audit cho mọi kết quả.

Các tier, từ thấp đến cao: `read`, `write`, `destructive`. Mỗi guild trong `config.yaml` có `max_tier`; tier hiệu lực của người gọi là giá trị thấp hơn giữa `max_tier` và những gì quyền Discord của họ cho phép (người gọi qua stdio nhận tier theo config).

## 2. Yêu cầu

- Node.js 22 trở lên
- pnpm (`corepack enable pnpm` hoặc `npm i -g pnpm`)
- Tài khoản Discord có thể tạo application và quản lý guild đích
- Tùy chọn: `claude` CLI (Claude Code) hoặc Claude Desktop làm MCP client

## 3. Thiết lập Discord Developer Portal

1. Mở <https://discord.com/developers/applications> và chọn **New Application**.
2. Ở **General Information**, copy **Application ID**. Đây là `DISCORD_CLIENT_ID`.
3. Mở **Bot** và chọn **Reset Token**. Copy token. Đây là `DISCORD_BOT_TOKEN`. Token chỉ hiện một lần; không bao giờ commit.
4. Vẫn ở **Bot**, trong **Privileged Gateway Intents**, bật **Server Members Intent**. Bắt buộc: thiếu nó thì khởi động lỗi `Used disallowed intents`. Chỉ bật **Message Content Intent** nếu bạn muốn nội dung tin nhắn trong events, và khi đó cũng đặt `message_content_intent: true` trong `config.yaml`.
5. Chỉ với chế độ HTTP: mở **OAuth2**, copy **Client Secret** (`DISCORD_CLIENT_SECRET`), và trong **Redirects** thêm `<PUBLIC_BASE_URL>/callback`, ví dụ `https://mcp.example.com/callback` hoặc `http://localhost:8787/callback`. Phải khớp chính xác với `PUBLIC_BASE_URL`.
6. Tạo URL mời bot (chạy được sau bước 4 của mục kế tiếp; chỉ cần client id):

   ```bash
   node dist/cli/main.js invite-url --client-id <application id> --permissions manager
   ```

   Các preset tích lũy dần: `read` (xem channel, đọc lịch sử, xem audit log), `moderator` (thêm kick, ban, timeout, quản lý message và thread), `manager` (thêm quản lý channel, server, role, webhook, expression, event, invite, gửi, react, embed; là mặc định) và `admin` (Administrator). Cũng nhận bitfield quyền dạng số; preset không hợp lệ sẽ thoát với mã khác 0. Nếu đã đặt `DISCORD_CLIENT_ID` thì có thể bỏ `--client-id`.
7. Mở URL được in ra, chọn guild và cấp quyền.
8. Trong Discord, mở **Server Settings > Roles** và kéo role của bot **lên trên mọi role mà nó phải quản lý**. Discord từ chối sửa bất kỳ role nào, hoặc member nào đang giữ role, ngang hoặc cao hơn role cao nhất của bot.

## 4. Cài đặt và build

```bash
git clone <this repository> discord-mcp
cd discord-mcp
pnpm install
pnpm build
```

Build tạo ra `dist/cli/main.js`. Trong README này, `discord-mcp` nghĩa là `node /absolute/path/to/discord-mcp/dist/cli/main.js` (file có thể thực thi và có shebang, nên bạn cũng có thể đưa nó vào `PATH`).

## 5. Cấu hình

### 5.1 `.env`

```bash
cp .env.example .env
```

CLI đọc `.env` từ thư mục hiện tại khi khởi động; biến đã có sẵn trong môi trường được ưu tiên. Không bao giờ commit `.env`.

| Biến | Cần cho | Ý nghĩa |
|---|---|---|
| `DISCORD_BOT_TOKEN` | luôn luôn | Token bot từ bước 3.3 |
| `DISCORD_CLIENT_ID` | HTTP, `invite-url` | Application ID |
| `DISCORD_CLIENT_SECRET` | HTTP | OAuth2 client secret |
| `PUBLIC_BASE_URL` | HTTP | URL công khai của server, không có dấu `/` cuối; metadata OAuth và redirect Discord được dựng từ đây |
| `DISCORD_MCP_CONFIG` | tùy chọn | Đường dẫn config khi không truyền `--config` (mặc định `config.yaml`) |
| `LOG_LEVEL` | tùy chọn | Mức pino, mặc định `info`; log là JSON trên stderr |

### 5.2 `config.yaml`

```bash
cp config.example.yaml config.yaml
```

```yaml
guilds:
  "123456789012345678":
    max_tier: destructive
tools:
  deny: []
rate_limits:
  bulk_per_minute: 5
events:
  retention_hours: 72
  max_buffer: 50000
http:
  host: 127.0.0.1
  port: 8787
  trust_proxy: false
  allowed_redirect_uris: []
  max_clients: 1000
  max_sessions_per_principal: 10
  service_tokens: []
safety:
  allow_token_confirm: false
rules:
  max_per_guild: 50
  min_cooldown_sec: 1
message_content_intent: false
database_path: ./discord-mcp.db
```

| Trường | Ý nghĩa |
|---|---|
| `guilds` | **Allowlist.** Key là guild id (snowflake, đặt trong dấu nháy). Cần ít nhất một guild. Guild không có trong danh sách thì mọi tool, rule và event đều không truy cập được. |
| `guilds.<id>.max_tier` | `read`, `write` hoặc `destructive`: tier cao nhất mà bất kỳ người gọi nào có thể đạt trong guild đó. Dùng `read` cho guild bạn chỉ muốn quan sát. |
| `tools.deny` | Tên tool không bao giờ được đăng ký và không bao giờ chạy, ví dụ `[guild_prune, mod_bulk_ban]`. |
| `rate_limits.bulk_per_minute` | Token bucket theo guild cho các tool bulk `messages_purge`, `roles_bulk_assign`, `mod_bulk_ban` và `guild_prune`. Mặc định 5. |
| `events.retention_hours` | Event gateway được đệm cũ hơn mức này sẽ bị xóa. Mặc định 72. |
| `events.max_buffer` | Số event đệm tối đa; event cũ nhất bị bỏ trước. Mặc định 50000. |
| `http.host`, `http.port` | Địa chỉ bind cho `--http`. Mặc định `127.0.0.1` và `8787`. Chỉ đặt `host: 0.0.0.0` rõ ràng khi server chạy trong container hoặc sau reverse proxy truy cập nó qua mạng. |
| `http.trust_proxy` | Có tin `X-Forwarded-For` để lấy IP client hay không (giới hạn tốc độ và log). `false` (mặc định), `true`, số hop proxy (`1` cho một reverse proxy) hoặc chuỗi danh sách CIDR. Để `false` trừ khi có reverse proxy do bạn kiểm soát đặt header này; nếu không client có thể giả IP để né giới hạn theo IP. |
| `http.allowed_redirect_uris` | Các redirect URI chính xác mà OAuth client được đăng ký và dùng. Client dùng custom scheme phải được liệt kê chính xác. Để trống (mặc định) cho phép URI `https` và loopback `http://127.0.0.1`, `http://localhost`, `http://[::1]` ở mọi port và path. |
| `http.max_clients` | Giới hạn số OAuth client đăng ký động. Mặc định 1000. |
| `http.max_sessions_per_principal` | Giới hạn số phiên MCP đồng thời cho mỗi người dùng đăng nhập hoặc service token, ngoài giới hạn toàn cục. Mặc định 10. Event stream đang mở được tính là hoạt động đối với đợt dọn phiên nhàn rỗi. |
| `safety.allow_token_confirm` | Mặc định `false`: lệnh destructive yêu cầu client hỗ trợ MCP elicitation và được xác nhận ngay trong luồng. Nếu client không thể elicit, lệnh thất bại an toàn với `confirm_required` và không có token. Đặt `true` để cho phép thêm luồng hai bước `confirm_token` (mục 8.1). |
| `rules.max_per_guild` | Số automation rule tối đa mỗi guild. Mặc định 50. |
| `rules.min_cooldown_sec` | `cooldown_sec` tối thiểu của một rule. Mặc định 1. |
| `http.service_tokens` | Bearer token tĩnh cho automation, dạng `{ name, sha256 }` với `sha256` là SHA-256 hex của token. Service token chỉ chịu chính sách config (như stdio). Tạo bằng `printf '%s' "$TOKEN" \| shasum -a 256`. |
| `message_content_intent` | Chỉ đặt `true` sau khi đã bật Message Content Intent trên portal. Nếu không, message event không có `content`. |
| `database_path` | File SQLite cho audit, xác nhận, events, rules và trạng thái OAuth. Dùng đường dẫn bền vững khi chạy như dịch vụ. Đường dẫn tương đối được tính từ thư mục chứa file config, không phải thư mục làm việc. Mỗi database chỉ một tiến trình được dùng: instance thứ hai trên cùng file sẽ từ chối khởi động (lock file `<database_path>.lock`; lock cũ do tiến trình crash để lại sẽ được tiếp quản). |

Đảm bảo guild id là guild bạn đã mời bot vào (bật Developer Mode, chuột phải vào server trong Discord và chọn **Copy Server ID**).

## 6. Kiểm tra

```bash
discord-mcp --check --config config.yaml
discord-mcp --check --config config.yaml --online
```

- Khi không có `--online`, `--check` kiểm tra file config (mọi trường lỗi được liệt kê dạng `path: message`) và các biến môi trường bắt buộc, rồi mở một store trong bộ nhớ.
- `--online` còn kết nối bằng bot token và xác nhận bot là thành viên của mọi guild đã cấu hình.
- Thêm `--http` để yêu cầu cả `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` và `PUBLIC_BASE_URL`.

Thành công thì in `ok` và thoát với mã 0; ngược lại mỗi vấn đề được in dạng `- <problem>` và mã thoát là 1.

## 7. Sử dụng

### 7.1 Claude Code, stdio

```bash
claude mcp add discord \
  -e DISCORD_BOT_TOKEN=<bot token> \
  -e DISCORD_MCP_CONFIG=/absolute/path/config.yaml \
  -- node /absolute/path/discord-mcp/dist/cli/main.js
```

Dùng đường dẫn tuyệt đối: Claude Code khởi chạy tiến trình từ thư mục làm việc của chính nó, nên `.env` và `config.yaml` tương đối sẽ không được tìm thấy trừ khi bạn truyền `-e` và `--config`. Sau đó chạy `/mcp` trong Claude Code để thấy server và thử `server_whoami`.

### 7.2 Claude Desktop, stdio

Sửa `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/discord-mcp/dist/cli/main.js", "--config", "/absolute/path/config.yaml"],
      "env": { "DISCORD_BOT_TOKEN": "<bot token>" }
    }
  }
}
```

Khởi động lại Claude Desktop. Log đi ra stderr và hiện trong MCP log của client.

### 7.3 Chế độ HTTP với đăng nhập OAuth

Chạy server như một dịch vụ lâu dài:

```bash
discord-mcp --http --config config.yaml
```

Endpoint: `POST/GET/DELETE /mcp` (streamable HTTP), `GET /healthz` (`{"status":"ok","gateway":"ready","db":"ok"}`, hoặc HTTP 503 với `"status":"degraded"` khi gateway chưa sẵn sàng hoặc database lỗi), các endpoint OAuth (`/authorize`, `/token`, `/register`, `/revoke`, `/callback`) và hai tài liệu metadata `.well-known`.

`PUBLIC_BASE_URL` phải là URL mà client dùng để truy cập server (trên production hãy đặt TLS phía trước, ví dụ reverse proxy), và `<PUBLIC_BASE_URL>/callback` phải được đăng ký làm redirect trong Discord portal.

Kết nối Claude Code:

```bash
claude mcp add --transport http discord https://mcp.example.com/mcp
```

Sau đó chạy `/mcp` trong Claude Code và chọn **Authenticate**. Luồng như sau:

1. Client tự đăng ký (dynamic client registration) và đưa bạn tới `/authorize` với PKCE.
2. Server chuyển bạn sang Discord để đăng nhập (scope `identify guilds`).
3. Tại `/callback`, server chỉ giữ lại các guild mà bạn là Administrator hoặc có Manage Server, bot có mặt, và guild nằm trong `config.yaml`. Nếu không có guild nào bạn nhận `access_denied`.
4. Client nhận access token một giờ và refresh token xoay vòng 30 ngày (cả hai đều opaque, lưu dạng hash).

Quyền của bạn được đọc lại khi refresh token và mỗi khi có role hoặc member event liên quan đến bạn. Nếu bạn mất quyền, guild đó bị loại khỏi phiên và mọi rule bạn sở hữu ở đó bị vô hiệu hóa.

Với script và CI, dùng service token thay vì đăng nhập: thêm hash của nó vào `http.service_tokens` và truyền `--header "Authorization: Bearer <token>"` cho `claude mcp add --transport http`.

Đăng nhập HTTP hiện trang đồng ý trước: `/authorize` hiển thị tên client và redirect URI chính xác của nó, và chỉ sau khi bạn xác nhận (form có chống CSRF) mới chuyển sang Discord. State của callback được gắn với trình duyệt của bạn bằng cookie, nên reverse proxy phải chuyển `Cookie` và `Set-Cookie` nguyên vẹn.

### 7.4 Chạy như dịch vụ (Docker, supervisord)

Chế độ HTTP được thiết kế để chạy dưới một supervisor. Trong container `all-in-one` chạy các dịch vụ bằng supervisord, thêm một program như:

```ini
[program:discord-mcp]
command=node /opt/discord-mcp/dist/cli/main.js --http --config /etc/discord-mcp/config.yaml
directory=/opt/discord-mcp
environment=DISCORD_MCP_CONFIG="/etc/discord-mcp/config.yaml",LOG_LEVEL="info"
autorestart=true
stdout_logfile=/var/log/discord-mcp.out.log
stderr_logfile=/var/log/discord-mcp.err.log
```

Bind mặc định là `127.0.0.1`, không truy cập được từ bên ngoài container. Đặt `http.host: 0.0.0.0` trong config, đặt reverse proxy TLS phía trước, và đặt `http.trust_proxy: 1` (số proxy) để IP client lấy từ `X-Forwarded-For`; nếu không có proxy, giữ `trust_proxy: false`.

Cung cấp `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` và `PUBLIC_BASE_URL` qua môi trường container hoặc file `.env` trong `directory`, và để `database_path` trên một volume được mount để audit, rule và phiên không mất khi restart. Sau khi đổi config hoặc deploy bản build mới, restart:

```bash
docker exec all-in-one supervisorctl restart discord-mcp
```

SIGINT, SIGTERM và SIGHUP đóng gateway, HTTP server và database một cách sạch sẽ, và có thể dùng `/healthz` làm health check cho container.

### 7.5 Chạy bằng Docker

Repo có sẵn `Dockerfile` (multi-stage, `node:22-slim`, user không phải root, `NODE_ENV=production`), `.dockerignore`, `docker-compose.yml` và `config.docker.example.yaml`. Secret không bao giờ được đóng vào image: truyền qua biến môi trường (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL`). `.env` bị loại khỏi build context.

Bắt đầu nhanh, theo thứ tự:

1. Tạo thư mục data và config, rồi sửa guild id trong `data/config.yaml` thành id server của bạn:

   ```bash
   mkdir -p data && cp config.docker.example.yaml data/config.yaml
   ```

2. Trên Linux, cho user của container (uid 1000) quyền ghi vào `./data`: `sudo chown 1000:1000 data`.
3. Tạo `.env` với `DISCORD_BOT_TOKEN`, cùng `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` và `PUBLIC_BASE_URL` (container chạy với `--http`).
4. Build và khởi động (bên dưới).

Lối tắt: nếu thiếu `/data/config.yaml` và đã đặt `DISCORD_MCP_GUILD_ID`, một config tối thiểu sẽ được sinh từ môi trường (guild đó ở tier `DISCORD_MCP_MAX_TIER`, mặc định `write`; `http.host: 0.0.0.0`; database cạnh config). Với bất cứ việc gì ngoài lần thử đầu, hãy dùng `config.yaml` thật.

Lỗi cấu hình (thiếu hoặc không đọc được config, thư mục data không ghi được, thiếu biến môi trường) in ra một thông báo và thoát với mã 78 (EX_CONFIG), khác với crash lúc chạy (mã 1). File compose dùng `restart: unless-stopped`: dịch vụ crash hoặc lỗi tạm thời (ví dụ Discord sập lúc boot) tự phục hồi, còn sai cấu hình hiện là `Restarting` trong `docker compose ps` khi Docker tăng dần thời gian chờ giữa các lần thử, với một thông báo rõ ràng trong `docker compose logs discord-mcp`. Sửa file và nó khởi động ở lần thử kế tiếp; một bot dừng vĩnh viễn là lỗi tệ hơn đối với dịch vụ moderation.

Ví dụ Docker đặt `http.host: 0.0.0.0` (bắt buộc trong container, vì mặc định là `127.0.0.1`) và `database_path: /data/discord-mcp.db`. Đặt `http.trust_proxy` bằng số reverse proxy phía trước container (ví dụ `1`) khi chạy sau proxy; nếu không thì giữ `false`. Container chạy với uid 1000 nên `data` phải ghi được bởi user đó (`chown 1000 data`).

Build và chạy:

```bash
docker build -t discord-mcp .
docker run -d --name discord-mcp --init --restart unless-stopped \
  --env-file .env -v "$PWD/data:/data" -p 127.0.0.1:8787:8787 discord-mcp
```

Hoặc dùng compose (đọc `.env`, mount `./data`, chỉ publish `127.0.0.1:8787`):

```bash
docker compose up -d --build
docker compose logs -f discord-mcp
```

Publish trên `127.0.0.1` giữ port ở chế độ riêng tư; hãy mở ra qua reverse proxy TLS và đặt `PUBLIC_BASE_URL` thành URL HTTPS công khai. Image có `HEALTHCHECK` gọi `/healthz` (503 khi gateway sập). Lỗi đăng nhập Discord, ví dụ bot token không hợp lệ, khiến tiến trình thoát kèm thông báo thay vì tiếp tục phục vụ.

Mỗi volume `/data` chỉ một container được dùng: tiến trình thứ hai trên cùng database sẽ từ chối khởi động. Nâng cấp bằng `git pull && docker compose up -d --build` (hoặc build lại và chạy lại); database tự migrate khi khởi động và bản build cũ hơn sẽ từ chối database mới hơn. `docker stop` gửi SIGTERM, đóng gateway, HTTP server và database sạch sẽ.

Đã kiểm thử: build image, user không phải root, ngữ nghĩa lệnh healthcheck (200 đạt, 503 hỏng) và xử lý SIGTERM. Chưa kiểm thử với token Discord thật.

### 7.6 Deploy trên server Ubuntu

Deploy từ image riêng tư `phuc16/discord-mcp` bằng `docker-compose.server.yml` (không build trên server; tên file tùy ý nên đổi thành `docker-compose.prod.yml` cũng được miễn là truyền bằng `-f`). Nó chạy image với uid 1000 và root filesystem chỉ đọc (`/tmp` là tmpfs; database SQLite, các file WAL và lock file nằm trong `./data`, đường dẫn ghi được duy nhất), bỏ mọi capability, `no-new-privileges`, giới hạn bộ nhớ và pids, log json-file có xoay vòng, và port chỉ publish trên `127.0.0.1:8787`.

**Bước 1: TLS phía trước (bắt buộc).** Chế độ HTTP từ chối khởi động trừ khi `PUBLIC_BASE_URL` là `https://` (`http://` thường chỉ được chấp nhận cho localhost). Dùng một **subdomain riêng** như `mcp.example.com`, không phải một đường dẫn trên site có sẵn: các endpoint OAuth (`/authorize`, `/token`, `/register`, `/callback`) và metadata `/.well-known/*` phải nằm ở gốc origin. Tạo bản ghi DNS `A` cho subdomain trỏ về server, rồi chọn một proxy. Ở cả hai trường hợp, đặt `http.trust_proxy: 1` trong `data/config.yaml` (một hop, proxy cùng host), giữ port compose ở `127.0.0.1:8787:8787`, đặt `PUBLIC_BASE_URL=https://your.domain` trong `.env`, và đăng ký `https://your.domain/callback` làm redirect URI của Discord (`discord-mcp --check --http` sẽ in ra). Cả hai proxy đều chuyển `Cookie` và `Set-Cookie` nguyên vẹn.

*Lựa chọn A: Caddy* (chưa có web server). `sudo apt install caddy`, rồi `/etc/caddy/Caddyfile`:

```
your.domain {
    reverse_proxy 127.0.0.1:8787
}
```

`sudo systemctl reload caddy`. Caddy tự lấy chứng chỉ. Mở port 80 (cấp chứng chỉ) và 443, không bao giờ mở 8787: `sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable`.

*Lựa chọn B: nginx với certbot* (server đã chạy nginx và các site khác; server block mới tách riêng và không đụng đến gì khác). Tạo `/etc/nginx/sites-available/discord-mcp`:

```nginx
server {
    listen 80;
    server_name mcp.example.com;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

`Connection ""` (không phải `upgrade`) là có chủ ý: luồng sự kiện trực tiếp là một response HTTP streaming sống lâu, không phải WebSocket; `proxy_buffering off` và timeout dài giúp luồng chảy liên tục. Sau đó bật nó và lấy chứng chỉ; certbot sửa block để thêm listener HTTPS và redirect:

```bash
sudo ln -s /etc/nginx/sites-available/discord-mcp /etc/nginx/sites-enabled/discord-mcp
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mcp.example.com
```

Port 80 và 443 thường đã mở cho các site khác của bạn; 8787 phải luôn đóng.

*Kiểm tra* (sau khi bước 2 đã chạy container):

```bash
curl -s https://mcp.example.com/healthz
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.example.com/mcp
claude mcp add --transport http discord https://mcp.example.com/mcp
```

`/healthz` trả về `{"status":"ok",...}`, `POST /mcp` không xác thực trả về `401`, và sau `claude mcp add` hãy chạy `/mcp` trong Claude Code để đăng nhập bằng Discord.

**Bước 2: ứng dụng.**

1. Cài Docker Engine và compose plugin (xem docs.docker.com/engine/install/ubuntu), rồi đăng nhập vào repository riêng tư: `docker login -u phuc16`.
2. Tạo thư mục làm việc với thư mục data thuộc quyền user của container:

   ```bash
   mkdir -p ~/discord-mcp/data && cd ~/discord-mcp
   sudo chown 1000:1000 data
   ```

3. Copy `docker-compose.server.yml`, `config.docker.example.yaml` và `.env.example` từ repository sang thư mục đó. Sau đó `cp config.docker.example.yaml data/config.yaml` và sửa guild id (và `trust_proxy: 1`), rồi `cp .env.example .env` và điền `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` và `PUBLIC_BASE_URL=https://your.domain`. Giữ `.env` riêng tư: `chmod 600 .env`.
4. Khởi động: `docker compose -f docker-compose.server.yml pull && docker compose -f docker-compose.server.yml up -d`.
5. Kiểm tra: `docker compose -f docker-compose.server.yml ps` hiện `healthy`, `docker compose -f docker-compose.server.yml logs -f discord-mcp` hiện log, và `curl -s http://127.0.0.1:8787/healthz` trả về `{"status":"ok",...}`.

**Cập nhật và rollback.** File compose mặc định pull `latest`. Để cập nhật: `docker compose -f docker-compose.server.yml pull && docker compose -f docker-compose.server.yml up -d`. Để ghim hoặc rollback, đặt `DISCORD_MCP_TAG` (ví dụ trong `.env` hoặc shell) thành một version tag như `0.1.0` hoặc `sha-<commit>` rồi chạy hai lệnh trên. Database migrate tiến lên khi khởi động; bản build cũ hơn database sẽ từ chối khởi động, nên hãy sao lưu trước khi nâng cấp.

**Sao lưu.** Mọi thứ có trạng thái nằm trong `./data` (`config.yaml` và database SQLite). Để có bản sao nhất quán, hãy dừng dịch vụ hoặc dùng online backup của SQLite: `docker compose -f docker-compose.server.yml stop && tar czf discord-mcp-data-$(date +%F).tar.gz data && docker compose -f docker-compose.server.yml start`.

**Phương án khác.** Nếu bạn đã chạy container `all-in-one` dưới supervisord, hãy chạy nó như một program của supervisord (7.4) và restart bằng `docker exec all-in-one supervisorctl restart <service-name>`.

Publish (dành cho maintainer): `scripts/publish-image.sh` build `linux/amd64` và `linux/arm64`, gắn tag `<version>`, `latest` và `sha-<commit>`, rồi push lên `phuc16/discord-mcp`; `--dry-run` chỉ build cục bộ. Cần git tree sạch và đăng nhập Docker Hub. Image không chứa sourcemap.

## 8. Dùng các tool

Hỏi bằng ngôn ngữ tự nhiên; client sẽ chọn tool. Ví dụ theo nhóm:

| Nhóm | Ví dụ câu lệnh |
|---|---|
| guild | "Cho tôi xem chi tiết và số thành viên của guild 1234…", "Đổi tên server thành Lounge." |
| channels | "Liệt kê các channel", "Tạo text channel tên announcements trong category Info", "Đặt #staff riêng tư cho role Mods." |
| threads | "Liệt kê các thread đang hoạt động", "Mở thread từ tin nhắn đó tên Follow-up", "Tạo một forum post trong #help." |
| roles | "Tạo role Helper màu xanh", "Gán role Helper cho @alice", "Gán Helper cho 30 người này." |
| members | "Tìm member tên bob", "Đổi nickname của @carol", "Chuyển @dave sang voice channel Lobby." |
| moderation | "Timeout @erin 10 phút", "Ban @mallory và xóa tin nhắn trong 1 ngày qua", "Tạo automod rule chặn link mời." |
| messages | "Đăng nội quy vào #welcome", "Ghim tin nhắn đó", "Xóa 200 tin nhắn gần nhất của @spammer trong #general." |
| webhooks | "Tạo webhook trong #alerts và đăng một tin nhắn thử." |
| scheduled_events | "Lên lịch đêm xem phim thứ Sáu 20:00 ở Stage channel." |
| invites | "Tạo lời mời 1 ngày tới #welcome dùng được 10 lần." |
| emojis | "Tải ảnh này lên làm emoji tên party." |
| audit_log | "Ai đã xóa channel trong vài ngày qua?" |
| meta | "Tôi là ai ở đây và đang có tier nào?", "Có gì xảy ra trong guild kể từ event 500?" |

### 8.1 Xác nhận thao tác destructive

Tool destructive không bao giờ hành động ở lần gọi đầu. Mặc định chúng cần client hỗ trợ MCP elicitation: client yêu cầu bạn xác nhận bản xem trước ngay trong luồng, và lệnh chỉ chạy nếu bạn đồng ý. Nếu client không thể elicit (hoặc elicitation lỗi), lệnh thất bại an toàn với `confirm_required` và không có token, và không có gì thay đổi. Để cho phép luồng token bên dưới cho các client như vậy, đặt `safety.allow_token_confirm: true`; khi tắt, xác nhận bị từ chối sẽ đơn giản là bị chặn.

Với `safety.allow_token_confirm: true`, câu "xóa channel #old-news" tạo ra lệnh `channels_delete` trả về kết quả lỗi như:

```json
{
  "error": {
    "code": "confirm_required",
    "message": "confirmation required",
    "details": {
      "preview": { "summary": "Delete channel #old-news", "affected": { "channels": 1 } },
      "confirm_token": "…",
      "expires_in_sec": 300
    }
  }
}
```

Client hiện bản xem trước cho bạn. Nếu bạn đồng ý, nó lặp lại đúng lệnh đó kèm `confirm_token`. Token chỉ dùng một lần, hiệu lực 5 phút và gắn với chính xác input và người gọi. Do đó:

- Dùng lại token đã dùng trả về `confirm_invalid`.
- Đổi bất kỳ tham số nào, dùng người gọi khác, hoặc chờ quá 5 phút đều trả về `confirm_invalid`.
- Phản hồi `confirm_required` là một lần chạy thử (dry run): không có gì bị thay đổi, và audit log ghi nó với kết quả `dry_run`.
- Client hỗ trợ MCP elicitation luôn được hỏi xác nhận ngay trong luồng trước; token chỉ được trả về khi elicitation không khả dụng hoặc bị từ chối.
- Giới hạn: `messages_purge` xóa tối đa 1000 tin nhắn mỗi lần gọi; `roles_bulk_assign` và `mod_bulk_ban` tối đa 200 đối tượng mỗi lần gọi.

### 8.2 Audit trail

Mỗi lần gọi ghi một dòng audit với kết quả `ok`, `dry_run`, `denied` hoặc `error`, tool, tier, guild, actor, hash của input (không bao giờ lưu input thô) và độ trễ. Đọc bằng `audit_query` ("cho xem 20 lần ban gần nhất trong guild này"), lọc theo tool hoặc actor; người gọi chỉ thấy các guild họ đọc được. Audit log của chính Discord hiển thị hành động của bot với lý do dạng `via discord-mcp by <user> (<correlation id>)`.

## 9. Events và rules

### 9.1 Events

Bot đệm các event gateway theo từng guild trong allowlist: `message_create`, `message_update`, `message_delete`, `member_join`, `member_remove`, `member_ban`, `member_unban`, `role_create`, `role_update`, `role_delete`, `channel_create`, `channel_update`, `channel_delete`, `voice_state`, `scheduled_event` và `gap`. Event `gap` đánh dấu một lần gateway kết nối lại mà trong đó có thể đã bỏ lỡ event.

- **Polling:** `events_poll` với `guild_id`, `since_id` (bắt đầu từ 0), `types` và `limit` tùy chọn (tối đa 500). Trả về `items` và `next_cursor`; truyền id cuối cùng lại làm `since_id`.
- **Subscription:** đăng ký resource `discord://guild/{guild_id}/events`; server gửi `notifications/resources/updated` khi có event mới và bạn đọc resource để lấy chúng. Cách này chạy qua stdio và, vì các phiên HTTP có trạng thái, cả qua HTTP. Nếu client không giữ được stream, hãy polling.

### 9.2 Rules

Một rule phản ứng với một event và chạy các tool. Nhờ Claude tạo bằng `rules_create`, hoặc truyền trực tiếp các tham số. Các placeholder `{{event.data.<key>}}` và `{{event.guild_id}}` trong `input_template` được điền từ event; thiếu key thì action thất bại. Rule có `allow_destructive: true` hoặc action destructive không thể tạo bằng `rules_create`/`rules_update`; hãy dùng `rules_create_destructive`/`rules_update_destructive`, vốn đi qua xác nhận destructive (8.1).

Role chào mừng khi join:

```json
{
  "guild_id": "123456789012345678",
  "trigger": { "event": "member_join" },
  "actions": [
    { "tool": "roles_assign",
      "input_template": { "guild_id": "{{event.guild_id}}", "user_id": "{{event.data.user_id}}", "role_id": "222222222222222222" } }
  ]
}
```

Chào member mới, nhưng không áp dụng cho tài khoản dưới một tuần tuổi (một điều kiện):

```json
{
  "guild_id": "123456789012345678",
  "trigger": { "event": "member_join" },
  "conditions": [ { "op": "account_age_lt_days", "days": 7 } ],
  "actions": [
    { "tool": "roles_assign",
      "input_template": { "guild_id": "{{event.guild_id}}", "user_id": "{{event.data.user_id}}", "role_id": "333333333333333333" } }
  ],
  "cooldown_sec": 5
}
```

Gắn cờ tin nhắn chứa một cụm từ (nội dung tin nhắn cần `message_content_intent`):

```json
{
  "guild_id": "123456789012345678",
  "trigger": { "event": "message_create" },
  "conditions": [ { "op": "message_contains", "text": "free nitro" } ],
  "actions": [
    { "tool": "messages_send",
      "input_template": { "guild_id": "{{event.guild_id}}", "channel_id": "444444444444444444", "content": "Possible scam from <@{{event.data.author_id}}>" } }
  ]
}
```

Điều kiện: `equals`, `matches` (regex, tối đa 200 ký tự), `in`, `member_has_role`, `account_age_lt_days`, `message_contains`. `filter` của trigger là một map so sánh bằng trên dữ liệu event. Hãy thử `rules_test` với một event mẫu trước: nó báo rule có khớp hay không và input của action sau khi render, và không thực thi gì. Quản lý rule bằng `rules_list`, `rules_update` và `rules_delete`.

Rào chắn: rule chạy qua cùng pipeline với tool, với tư cách chủ rule; chủ rule cần ít nhất tier `write` trong guild; action destructive cần `allow_destructive: true` đặt lúc tạo và được audit dưới actor `rule:<id>`; mỗi rule có cooldown tùy chọn, mỗi guild bị giới hạn 30 rule action mỗi phút, một action không kích hoạt lại rule đã gây ra nó, và rule tự động bị vô hiệu hóa nếu chủ rule mất quyền.

## 10. Danh sách tool

Tier: **R** đọc, **W** ghi, **D** destructive (xem trước dry-run rồi `confirm_token`). Mọi tool đều nhận `guild_id` trừ các tool đọc không gắn guild được đánh dấu `*`.

| Nhóm | Tool |
|---|---|
| guild | `guild_list` R*, `guild_get` R, `guild_update` W, `guild_get_preview` R, `guild_get_prune_count` R, `guild_prune` D, `guild_get_widget` R, `guild_update_widget` W |
| channels | `channels_list` R, `channels_get` R, `channels_create` W, `channels_update` W, `channels_move` W, `channels_set_permissions` W, `channels_delete_permissions` W, `channels_delete` D, `channels_clone` W |
| threads | `threads_list_active` R, `threads_list_archived` R, `threads_create` W, `threads_update` W, `threads_add_member` W, `threads_remove_member` W, `threads_delete` D, `forum_create_post` W, `forum_list_tags` R, `forum_update_tags` W |
| roles | `roles_list` R, `roles_get` R, `roles_create` W, `roles_update` W, `roles_reorder` W, `roles_assign` W, `roles_remove` W, `roles_bulk_assign` D, `roles_delete` D |
| members | `members_list` R, `members_get` R, `members_search` R, `members_update_nick` W, `members_add_role` W, `members_remove_role` W, `members_move_voice` W, `members_disconnect_voice` W |
| moderation | `mod_timeout` W, `mod_remove_timeout` W, `mod_kick` D, `mod_ban` D, `mod_unban` W, `mod_bulk_ban` D, `mod_list_bans` R, `automod_list_rules` R, `automod_create_rule` W, `automod_update_rule` W, `automod_delete_rule` D |
| messages | `messages_list` R, `messages_get` R, `messages_send` W, `messages_edit` W, `messages_delete` D, `messages_purge` D, `messages_pin` W, `messages_unpin` W, `messages_list_pins` R, `messages_crosspost` W, `reactions_add` W, `reactions_remove` W, `reactions_clear` D, `messages_search` R |
| webhooks | `webhooks_list` R, `webhooks_create` W, `webhooks_update` W, `webhooks_execute` W, `webhooks_delete` D |
| scheduled_events | `sevents_list` R, `sevents_get` R, `sevents_create` W, `sevents_update` W, `sevents_list_users` R, `sevents_delete` D |
| invites | `invites_list` R, `invites_create` W, `invites_delete` D |
| emojis | `emojis_list` R, `emojis_create` W, `emojis_update` W, `emojis_delete` D, `stickers_list` R, `stickers_create` W, `stickers_delete` D |
| audit_log | `audit_log_list` R, `audit_log_by_user` R, `audit_log_by_action` R |
| meta | `server_whoami` R*, `server_policy` R*, `events_poll` R, `rules_create` W, `rules_list` R, `rules_update` W, `rules_create_destructive` D, `rules_update_destructive` D, `rules_delete` W, `rules_test` R, `audit_query` R |

`server_policy` cho thấy tier hiệu lực của bạn trên từng guild và các tool bị từ chối. Các tool hành động qua channel, webhook hoặc invite id sẽ kiểm tra tài nguyên đó thuộc `guild_id` đã cho trước khi hành động.

## 11. Lưu ý bảo mật và giới hạn

- **Secret:** bot token, client secret và mọi token đều bị loại khỏi log (che bằng pino cộng một bài test grep mọi response và dòng log). Giữ `.env` và `config.yaml` ngoài version control.
- **Đặc quyền tối thiểu:** mời bot bằng preset nhỏ nhất bạn cần, chỉ liệt kê các guild bạn cần, và đặt `max_tier: read` ở nơi bạn chỉ quan sát. Dùng `tools.deny` cho những tool bạn không bao giờ muốn.
- **Ràng buộc guild:** một `guild_id` trong allowlist không thể dùng để tác động lên channel, webhook hay invite của guild khác.
- **OAuth:** bắt buộc PKCE S256, redirect URI khớp chính xác, `state` chỉ dùng một lần với TTL 10 phút, refresh token xoay vòng và việc dùng lại token đã xoay sẽ thu hồi cả họ phiên, và CORS trên các endpoint token chỉ giới hạn ở origin của các redirect đã đăng ký.
- **Dynamic client registration là mở** nhưng giới hạn ở redirect URI `https` hoặc loopback (hoặc `http.allowed_redirect_uris`) và ở `http.max_clients` client. Client luôn là public (không có client secret); người dùng xác nhận từng client trên trang đồng ý trước khi đăng nhập Discord. Nếu cần giới hạn ai được đăng ký, hãy đặt việc đăng ký sau các kiểm soát mạng.
- **Rule action có `allow_destructive`** chạy không cần confirm token theo thiết kế sau khi đã tạo (tạo chúng cần tier destructive và xác nhận); chúng được audit dưới `rule:<id>`.
- **Giới hạn tốc độ bulk:** bộ giới hạn lấy một token trước bước dry-run, nên một phản hồi `confirm_required` cũng tiêu tốn một slot bulk.
- **CORS preflight trên `/mcp`:** `OPTIONS /mcp` trả về 401 (kiểm tra bearer chạy trước), nên các MCP client chạy trên trình duyệt khác origin không thể gọi `/mcp`.
- **Nội dung tin nhắn:** khi không có Message Content intent, điều kiện `message_contains` không bao giờ khớp và event không mang văn bản.
- **Giới hạn Discord API:** OAuth `fetchUserGuilds` trả về tối đa 200 guild; xóa hàng loạt tin nhắn bỏ qua tin nhắn cũ hơn 14 ngày.
- **Một tiến trình:** một instance sở hữu kết nối gateway và database SQLite; không chạy hai instance trên cùng một database.

## 12. Xử lý sự cố

| Triệu chứng | Nguyên nhân và cách sửa |
|---|---|
| Khởi động lỗi `Used disallowed intents` | Bật **Server Members Intent** (và Message Content Intent nếu `message_content_intent: true`) ở trang Bot của developer portal. |
| `--check` liệt kê `missing env var …` | Đặt nó trong `.env` hoặc môi trường. `.env` tương đối chỉ được đọc từ thư mục hiện tại. |
| `--check --online`: `bot is not a member of configured guild …` | Mời bot bằng `invite-url`, hoặc sửa guild id trong `config.yaml`. |
| `missing_permissions` | Bot thiếu quyền Discord. Mời lại bằng preset cao hơn hoặc cấp quyền cho role của bot. |
| Sửa role hoặc member lỗi `missing_permissions` | Phân cấp role: đưa role của bot lên trên các role và member mà nó phải quản lý. Bot không bao giờ sửa được chủ server. |
| `guild_not_allowed` | Guild không có trong `config.yaml`, hoặc (HTTP) bạn không phải Administrator hay người có Manage Server ở đó, hoặc bot không có mặt. |
| `tier_exceeded` | Tier của tool cao hơn tier hiệu lực: tăng `max_tier`, hoặc quyền Discord của bạn đang giới hạn bạn. `server_policy` cho thấy tier hiệu lực trên từng guild. Tool cũng có thể nằm trong `tools.deny`. |
| `confirm_required` ở mọi lệnh destructive | Client của bạn không hỗ trợ MCP elicitation. Dùng client có hỗ trợ, hoặc đặt `safety.allow_token_confirm: true` và lặp lại lệnh với `confirm_token` được trả về. `confirm_invalid` nghĩa là token đã dùng, hết hạn, hoặc input đã đổi. |
| `rate_limited` | Bộ giới hạn bulk (`rate_limits.bulk_per_minute`, chờ `details.retry_after`) hoặc giới hạn của chính Discord (429; details có `retry_after` tính bằng giây). Các endpoint OAuth cũng giới hạn theo một IP, trả HTTP 429. |
| `not_found` | Sai id, hoặc tài nguyên thuộc guild khác với `guild_id`. |
| HTTP 401 kèm `WWW-Authenticate` | Chưa đăng nhập hoặc token hết hạn/bị thu hồi: đăng nhập lại qua `/mcp`. |
| Đăng nhập kết thúc với `access_denied` | Không guild nào của bạn đủ điều kiện (Administrator hoặc Manage Server, bot có mặt, có trong allowlist). |
| `redirect_uri` không khớp ở Discord | `<PUBLIC_BASE_URL>/callback` phải được đăng ký chính xác trong portal. |
| `cannot read config file /data/config.yaml: it does not exist` (container thoát với mã 78) | `./data` đã được mount nhưng trống. Chạy `mkdir -p data && cp config.docker.example.yaml data/config.yaml`, sửa guild id, `chown 1000:1000 data` trên Linux, rồi restart. "not readable" nghĩa là uid 1000 không đọc được file. Hoặc đặt `DISCORD_MCP_GUILD_ID` để sinh config tối thiểu. |
| `database directory ... is not writable` (mã thoát 78) | User của container không ghi được vào thư mục data: `sudo chown 1000:1000 data`. |
| `PUBLIC_BASE_URL uses scheme "http" but must be https ...` (bản cũ: `Issuer URL must be HTTPS`) | `PUBLIC_BASE_URL` là `http://` trên host không phải local. Đặt reverse proxy TLS phía trước (mục 7.6, bước 1) và đặt `PUBLIC_BASE_URL=https://your.domain`. Giá trị phải là origin trần: không có path, query hay dấu `/` cuối. |
| `database ... is already in use` khi khởi động | Một tiến trình discord-mcp khác đang dùng database đó. Dừng nó, hoặc dùng `database_path` khác. |
| Không có event nào đến | Kiểm tra `/healthz` có `gateway: ready`, guild có trong `config.yaml`, và các intent. Event `gap` đánh dấu một lần kết nối lại. |

## 13. Phát triển

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:cov
pnpm build
pnpm check
```

`pnpm check` chạy typecheck, lint, test và build. Ranh giới import giữa các module `src/`, và quy tắc `discord.js` chỉ được import trong `src/discord/`, được eslint thực thi. Thiết kế nằm trong `docs/superpowers/specs/2026-09-29-discord-mcp-design.md` và bản review toàn nhánh trong `docs/review-2026-09-29.md`.
