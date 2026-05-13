# telegram-mcp

Cloudflare Worker exposing a Telegram bot as a Model Context Protocol server.

## Quick start

```bash
pnpm install
# Set secrets:
wrangler secret put TELEGRAM_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put MCP_SECRET   # optional auth token

# Deploy
wrangler deploy
```

Local dev: `wrangler dev`

## Tools exposed

| Tool | Description | Key inputs |
|------|-------------|------------|
| `send_message` | Send a message to the configured Telegram chat | `text` (required), `parse_mode` (HTML/Markdown/MarkdownV2) |
| `get_updates` | Fetch recent pending messages received by the bot | `limit` (1–100, default 10) |
| `get_bot_info` | Return metadata about the configured bot | — |

## Claude Desktop config

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["mcp-remote", "https://<your-worker>.workers.dev/mcp"],
      "headers": { "Authorization": "Bearer <MCP_SECRET>" }
    }
  }
}
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
