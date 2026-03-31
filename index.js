export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      });
    }

    try {
      const contentType = request.headers.get('content-type');
      let text;

      if (contentType && contentType.includes('application/json')) {
        const body = await request.json();
        text = body.text;
      } else if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await request.formData();
        text = formData.get('text');
      } else {
        return new Response('Content-Type must be application/json or application/x-www-form-urlencoded', {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      if (!text) {
        return new Response('Missing text parameter', {
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      // Collect client request information
      const clientIP = request.headers.get('CF-Connecting-IP') ||
        request.headers.get('X-Forwarded-For') ||
        request.headers.get('X-Real-IP') ||
        'Unknown';

      const userAgent = request.headers.get('User-Agent') || 'Unknown';
      const country = request.cf?.country || 'Unknown';
      const city = request.cf?.city || 'Unknown';
      const region = request.cf?.region || 'Unknown';
      const latitude = request.cf?.latitude || 'Unknown';
      const longitude = request.cf?.longitude || 'Unknown';
      const timezone = request.cf?.timezone || 'Unknown';
      const url = request.url || 'Unknown';
      const timestamp = new Date().toISOString();

      // Format the message with request information
      const hasCoordinates = latitude !== 'Unknown' && longitude !== 'Unknown';
      const mapLink = hasCoordinates
        ? `https://www.google.com/maps?q=${latitude},${longitude}`
        : null;

      const requestInfo = `<b>IP</b>: <code>${clientIP}</code> <a href="https://ipinfo.io/${clientIP}">🔍</a>
<b>Browser</b>: <code>${userAgent}</code>
<b>Country</b>: <code>${country}</code>
<b>Region</b>: <code>${region}</code>
<b>City</b>: <code>${city}</code>
<b>Coordinates</b>: <code>${latitude}, ${longitude}</code>${mapLink ? ` <a href="${mapLink}">📍</a>` : ''}
<b>Timezone</b>: <code>${timezone}</code>
<b>Timestamp</b>: <code>${timestamp}</code>
<b>Original text</b>:`;

      const formattedMessage = `${requestInfo}

${text}`;

      const telegramToken = env.TELEGRAM_TOKEN;
      const telegramChatId = env.TELEGRAM_CHAT_ID;

      if (!telegramToken || !telegramChatId) {
        return new Response('Missing TELEGRAM_TOKEN or TELEGRAM_CHAT_ID environment variables', {
          status: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      const telegramUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
      const telegramPayload = {
        chat_id: telegramChatId,
        text: formattedMessage,
        parse_mode: 'HTML'
      };

      const telegramResponse = await fetch(telegramUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(telegramPayload)
      });

      const telegramResult = await telegramResponse.json();

      if (!telegramResponse.ok) {
        return new Response(JSON.stringify({
          success: false
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      return new Response(JSON.stringify({
        success: true
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({
        success: false
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }
  },
};
