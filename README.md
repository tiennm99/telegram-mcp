# telegram-mcp

Telegram MCP server exposing a bot via the [Model Context Protocol](https://modelcontextprotocol.io). Can be hosted on Cloudflare Workers.

## Quick start

```bash
npm install
# Set secrets:
wrangler secret put TELEGRAM_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put MCP_SECRET   # optional auth token

# Deploy
wrangler deploy
```

Local dev: `wrangler dev`

## License

Apache-2.0 — see [LICENSE](LICENSE).
