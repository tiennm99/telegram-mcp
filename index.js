const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
        parse_mode: { type: 'string', enum: ['HTML', 'Markdown', 'MarkdownV2'], description: 'Formatting mode (default: HTML)' },
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

// --- Crypto helpers ---

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

async function sha256b64url(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return b64url(new Uint8Array(buf));
}

async function makeCode(secret, payload) {
  const data = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${data}.${await hmacSign(secret, data)}`;
}

async function parseCode(secret, code) {
  const i = code.lastIndexOf('.');
  if (i === -1) return null;
  const [data, sig] = [code.slice(0, i), code.slice(i + 1)];
  if (sig !== await hmacSign(secret, data)) return null;
  try { return JSON.parse(b64urlDecode(data)); } catch { return null; }
}

// --- Response helpers ---

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function mcpRes(id, result) {
  return jsonRes({ jsonrpc: '2.0', id, result });
}

function mcpErr(id, code, message) {
  return jsonRes({ jsonrpc: '2.0', id, error: { code, message } });
}

// --- Telegram ---

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// --- OAuth ---

function oauthMeta(origin) {
  return jsonRes({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
  });
}

function authorizePage(params, err = '') {
  const { state = '', code_challenge = '', redirect_uri = '', client_id = '' } = params;
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Telegram MCP — Authorize</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,sans-serif;max-width:360px;margin:80px auto;padding:0 20px}
    h2{margin-bottom:6px}p{color:#666;margin-bottom:20px}
    input[type=password]{width:100%;padding:9px 12px;border:1px solid #ccc;border-radius:6px;margin-bottom:12px;font-size:15px}
    button{width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:15px;cursor:pointer}
    button:hover{background:#1d4ed8}.err{color:#dc2626;font-size:14px;margin-bottom:12px}
  </style>
</head>
<body>
  <h2>Telegram MCP</h2>
  <p>Authorize Claude to access your Telegram bot.</p>
  ${err ? `<p class="err">${err}</p>` : ''}
  <form method="POST">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="code_challenge" value="${code_challenge}">
    <input type="hidden" name="redirect_uri" value="${redirect_uri}">
    <input type="hidden" name="client_id" value="${client_id}">
    <input type="password" name="secret" placeholder="MCP secret" autofocus autocomplete="current-password">
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

async function handleAuthorize(request, env) {
  if (request.method === 'GET') {
    const p = Object.fromEntries(new URL(request.url).searchParams);
    return authorizePage(p);
  }

  const form = await request.formData();
  const state = form.get('state') || '';
  const code_challenge = form.get('code_challenge') || '';
  const redirect_uri = form.get('redirect_uri') || '';
  const client_id = form.get('client_id') || '';
  const secret = form.get('secret') || '';
  const params = { state, code_challenge, redirect_uri, client_id };

  if (!env.MCP_SECRET) return authorizePage(params, 'Server error: MCP_SECRET not configured.');
  if (secret !== env.MCP_SECRET) return authorizePage(params, 'Invalid secret. Try again.');

  const code = await makeCode(env.MCP_SECRET, {
    code_challenge,
    redirect_uri,
    exp: Date.now() + 5 * 60 * 1000,
  });

  const dest = new URL(redirect_uri);
  dest.searchParams.set('code', code);
  dest.searchParams.set('state', state);
  return Response.redirect(dest.toString(), 302);
}

async function handleToken(request, env) {
  let params;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    params = await request.json();
  } else {
    params = Object.fromEntries(await request.formData());
  }

  const { code = '', code_verifier = '', redirect_uri = '' } = params;

  if (!env.MCP_SECRET) return jsonRes({ error: 'server_error' }, 500);

  const payload = await parseCode(env.MCP_SECRET, code);
  if (!payload) return jsonRes({ error: 'invalid_grant', error_description: 'Invalid code' }, 400);
  if (Date.now() > payload.exp) return jsonRes({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
  if (payload.redirect_uri !== redirect_uri) return jsonRes({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);

  const challenge = await sha256b64url(code_verifier);
  if (challenge !== payload.code_challenge) return jsonRes({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);

  return jsonRes({ access_token: env.MCP_SECRET, token_type: 'bearer' });
}

// --- MCP ---

async function handleMCP(request, env) {
  if (env.MCP_SECRET) {
    if (request.headers.get('Authorization') !== `Bearer ${env.MCP_SECRET}`) {
      return new Response('Unauthorized', { status: 401, headers: CORS });
    }
  }

  let body;
  try { body = await request.json(); } catch { return mcpErr(null, -32700, 'Parse error'); }

  const { id, method, params } = body;

  if (id === undefined) return new Response(null, { status: 202, headers: CORS });

  switch (method) {
    case 'initialize':
      return mcpRes(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });

    case 'ping':
      return mcpRes(id, {});

    case 'tools/list':
      return mcpRes(id, { tools: TOOLS });

    case 'tools/call': {
      const { name, arguments: args = {} } = params ?? {};
      const { TELEGRAM_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = env;

      if (!token || !chatId) {
        return mcpRes(id, { content: [{ type: 'text', text: 'Error: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set' }], isError: true });
      }

      if (name === 'send_message') {
        const result = await tg(token, 'sendMessage', { chat_id: chatId, text: args.text, parse_mode: args.parse_mode ?? 'HTML' });
        return mcpRes(id, {
          content: [{ type: 'text', text: result.ok ? 'Message sent.' : `Error: ${result.description}` }],
          isError: !result.ok,
        });
      }

      if (name === 'get_updates') {
        const result = await tg(token, 'getUpdates', { limit: Math.min(args.limit ?? 10, 100) });
        if (!result.ok) return mcpRes(id, { content: [{ type: 'text', text: `Error: ${result.description}` }], isError: true });
        const messages = result.result
          .filter(u => u.message?.text)
          .map(u => {
            const { message: m } = u;
            const from = m.from ? `${m.from.first_name}${m.from.username ? ` (@${m.from.username})` : ''}` : 'Unknown';
            return `[${new Date(m.date * 1000).toISOString()}] ${from}: ${m.text}`;
          })
          .join('\n');
        return mcpRes(id, { content: [{ type: 'text', text: messages || 'No pending messages.' }] });
      }

      if (name === 'get_bot_info') {
        const result = await tg(token, 'getMe', {});
        if (!result.ok) return mcpRes(id, { content: [{ type: 'text', text: `Error: ${result.description}` }], isError: true });
        const { first_name, username, id: botId } = result.result;
        return mcpRes(id, { content: [{ type: 'text', text: `Bot: ${first_name} (@${username}), ID: ${botId}` }] });
      }

      return mcpErr(id, -32601, `Unknown tool: ${name}`);
    }

    default:
      return mcpErr(id, -32601, `Method not found: ${method}`);
  }
}

// --- Router ---

export default {
  async fetch(request, env) {
    const { method } = request;
    const { pathname, origin } = new URL(request.url);

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (pathname === '/.well-known/oauth-authorization-server') return oauthMeta(origin);
    if (pathname === '/authorize') return handleAuthorize(request, env);
    if (pathname === '/token' && method === 'POST') return handleToken(request, env);
    if (pathname === '/' && method === 'POST') return handleMCP(request, env);

    return new Response('Not Found', { status: 404, headers: CORS });
  },
};
