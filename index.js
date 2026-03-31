const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
};

const SERVER_INFO = { name: 'telegram-mcp', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'send_message',
    description: 'Send a message to the configured Telegram chat',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text (supports HTML formatting)' },
        parse_mode: { type: 'string', enum: ['HTML', 'Markdown', 'MarkdownV2'], description: 'Text formatting mode (default: HTML)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_updates',
    description: 'Get recent pending updates (messages) received by the bot',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max number of updates to retrieve (1-100, default 10)' },
      },
    },
  },
  {
    name: 'get_bot_info',
    description: 'Get information about the configured Telegram bot',
    inputSchema: { type: 'object', properties: {} },
  },
];

function json(id, result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function error(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    if (env.MCP_SECRET) {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.MCP_SECRET}`) {
        return new Response('Unauthorized', { status: 401, headers: CORS });
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return error(null, -32700, 'Parse error');
    }

    const { id, method, params } = body;

    // Notifications (no id) — no response needed
    if (id === undefined) {
      return new Response(null, { status: 202, headers: CORS });
    }

    switch (method) {
      case 'initialize':
        return json(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case 'ping':
        return json(id, {});

      case 'tools/list':
        return json(id, { tools: TOOLS });

      case 'tools/call': {
        const { name, arguments: args = {} } = params ?? {};
        const { TELEGRAM_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = env;

        if (!token || !chatId) {
          return json(id, {
            content: [{ type: 'text', text: 'Error: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set' }],
            isError: true,
          });
        }

        if (name === 'send_message') {
          const result = await tg(token, 'sendMessage', {
            chat_id: chatId,
            text: args.text,
            parse_mode: args.parse_mode ?? 'HTML',
          });
          return json(id, {
            content: [{ type: 'text', text: result.ok ? 'Message sent.' : `Error: ${result.description}` }],
            isError: !result.ok,
          });
        }

        if (name === 'get_updates') {
          const result = await tg(token, 'getUpdates', { limit: Math.min(args.limit ?? 10, 100) });
          if (!result.ok) {
            return json(id, {
              content: [{ type: 'text', text: `Error: ${result.description}` }],
              isError: true,
            });
          }
          const messages = result.result
            .filter(u => u.message?.text)
            .map(u => {
              const { message: m } = u;
              const from = m.from ? `${m.from.first_name}${m.from.username ? ` (@${m.from.username})` : ''}` : 'Unknown';
              const time = new Date(m.date * 1000).toISOString();
              return `[${time}] ${from}: ${m.text}`;
            })
            .join('\n');
          return json(id, {
            content: [{ type: 'text', text: messages || 'No pending messages.' }],
          });
        }

        if (name === 'get_bot_info') {
          const result = await tg(token, 'getMe', {});
          if (!result.ok) {
            return json(id, {
              content: [{ type: 'text', text: `Error: ${result.description}` }],
              isError: true,
            });
          }
          const { first_name, username, id: botId } = result.result;
          return json(id, {
            content: [{ type: 'text', text: `Bot: ${first_name} (@${username}), ID: ${botId}` }],
          });
        }

        return error(id, -32601, `Unknown tool: ${name}`);
      }

      default:
        return error(id, -32601, `Method not found: ${method}`);
    }
  },
};
