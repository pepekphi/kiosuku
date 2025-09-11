- Remember to setup:
    - Repository secrets in Github ('Settings' / 'Secrets and variables' / 'Actions' / 'Repository secrets'):
      - MAINTENANCE24H_URL
      - MAINTENANCE3H_URL
  - Railway service (connected to Github)
    - Environment variables:
      - SUPABASE_KEY
      - SUPABASE_URL
      - TWITTER_BEARER_TOKEN
      - WEBHOOK_URL
      - STREAM_WS_TOKEN

WebSocket stream
----------------
The service exposes a WebSocket endpoint for low-latency consumers:

- Path: `/stream` on the same port as HTTP (shares `PORT`)
- Auth: provide the token via one of:
  - Query string: `?token=YOUR_TOKEN`
  - Header: `Authorization: Bearer YOUR_TOKEN`
  - Header: `x-auth-token: YOUR_TOKEN`

Notes:
- Per-message compression is disabled to minimize latency.
- The server sends ping frames every ~25s and closes clients that do not respond with `pong`.
- Messages are JSON containing forward-worthy posts and thread flushes with minimal fields:
  `{ "type": "post", "source": "TWEET", "id": string, "content": string, "author": string, "url": string, "createdAt": ISO8601 }`

Sample client (Node.js using `ws`):

```js
const WebSocket = require('ws');
const token = process.env.STREAM_WS_TOKEN;
const ws = new WebSocket(`ws://localhost:8080/stream?token=${encodeURIComponent(token)}`, { perMessageDeflate: false });

ws.on('open', () => console.log('WS connected'));
ws.on('close', () => console.log('WS closed'));
ws.on('error', (e) => console.error('WS error', e));
ws.on('message', (data) => {
  try { console.log('post', JSON.parse(data)); } catch {}
});
```
