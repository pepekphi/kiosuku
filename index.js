// IMPORTANT: Make sure to define SUPABASE_KEY, SUPABASE_URL, TWITTER_BEARER_TOKEN, and WEBHOOK_URL in environment variables. EDIT: Also STREAM_WS_TOKEN (DJT)

// Settings
const INACTIVITY_TIMEOUT = 120 * 60 * 1000; // 2 hours
const WAIT_FOR_THREAD_MS = 7600;
const MAX_TWEETS_PER_THREAD = 8;
const THREAD_EXPIRATION_MS = 1 * 60 * 1000; // 1 minute
const RETWEET_WINDOW_MS = 4 * 60 * 1000; // Retweets and quoted tweets need to be posted less than x minutes (first number) after the original tweet for them to be added to Supabase
const WS_PING_INTERVAL_MS = 25000; // 25s keep-alive ping interval

// Forwarding rules block START, also remove this "if (shouldForward(" 2 times if I decide to remove this block
const FORWARD_FILTERS = {
  green150: [
    /to announce/i,
    /we announce/i,
    / x /,
    / 🤝 /,
    /scoop:/i,
    /shipping announcement/i,
    /major announcement/i,
    /great news/i,
    /here's what's new/i,
    /incident/i,
    /exploit/i,
    /hack/i,
    /service outage/i,
    /compromised/i,
    / drain/i,
    /launching/i,
    /launched/i,
    /we've made/i,
    /we've done/i,
    /news:/i,
    /security alert/i,
    /debuting/i,
    /proud to/i,
    /pleased to/i,
    /excited to be/i,
    /re excited to/i,
    /is here/i,
    /are here/i,
    /excited to share/i,
    /is coming to/i,
    /is coming soon to/i,
    /arrives on/i,
    /upgrade incoming/i,
    /is now live/i,
    /is live/i,
    /to go live/i,
    /announcing/i,
    /announced/i,
    /announces/i,
    /launches/i,
    /to launch/i,
    /will launch/i,
    /introducing/i,
    /introduces/i,
    /is out now/i,
    /is out!/i,
    /is set to/i,
    /are set to/i,
    /to introduce/i,
    /releases/i,
    /have released/i,
    /has released/i,
    /kicks off /i,
    /unveil/i,
    /passes/i,
    /upgrade:/i,
    /core pce/i,
    /partners with/i,
    /is partnering/i,
    /update:/i,
    /update -/i,
    /update —/i,
    /updates:/i,
    /updates -/i,
    /updates —/i,
    /ism services/i,
    /big news/i,
    /exciting news/i,
    /starting today/i,
    / has now/i,
    /have now/i,
    / is now/i,
    / are now/i,
    /can now be/i,
    /now supports/i,
    /will add support for/i,
    /has received/i,
    /receives/i,
    /are live/i,
    /gone live/i,
    /will go live/i,
    /just got/i,
    /just made/i,
    /has\s+\w+ed\b/i,
    /have\s+\w+ed\b/i,
    /we've\s+\w+ed\b/i,
    /\bjust\s+\w+ed\b/i,
    /\bwe're\s+\w+ing\b/i,
    /\bis\s+\w+ing\b/i,
    /\bare\s+\w+ing\b/i,
    /\bhas been\s+\w+ed\b/i,
    /added to the roadmap/i,
    /(?=.*(binance|bybit|coinbase|upbit|okx|bithumb|bitget|robinhood|robin hood|paypal|revolut))(?=.*(lists|listed|added to|addition|listing|will list|to list|activate|launch|will add|now supports|expanded|is now available|suspen|delist|remov|to add|will support|to support))/i,
    /(?=.*etfs?)(?=.*(appli|apply|file|submit|filing|register|approv|grant|cleared|greenlight|award|amend|submit updated|s-1 form|reject|denied|denies|to launch on|to go live on|no further comments|delay|postpone))/i,
    /investment warning/i,
    /precautionary alert/i
  ],
  green20: [
    /^(?=.{0,20})just in/i,
    /^(?=.{0,20})breaking/i,
    /^(?=.{0,20})presenting/i,
    /^(?=.{0,20})announcement/i,
    /^(?=.{0,20})bullish:/i,
    /^(?=.{0,20})bearish:/i,
    /^(?=.{0,20})intel:/i,
    /^(?=.{0,20})today/i,
    /^(?=.{0,20})now:/i,
    /^(?=.{0,20})new:/i,
    /^(?=.{0,20})latest/i,
    /^(?=.{0,20})that was quick/i
  ],
  green10: [
    /^(?=.{0,10})alert/i,
    /^(?=.{0,10})scoop/i,
    /^(?=.{0,10})new/i,
    /^(?=.{0,10})now/i,
    /^(?=.{0,10})meet /i,
    /^(?=.{0,10})live:/i,
    /^(?=.{0,10})🚨/
  ],
  greenAllCaps: /^[^a-z]*[A-Z][^a-z]*$/,
  redStart: [
    /^insight/i,
    /^join us /i,
    /^a research /i,
    /^opinion/i,
    /^analysis/i,
    /^be a part of/i,
    /^be part of/i
  ],
  red260: [
    /community call/i,
    /recap /i,
    /contest/i,
    /hackathon/i,
    /sparks hope/i,
    /sparks fear/i,
    / booth/i,
    /register now/i,
    /will donate/i,
    /all-time high/i,
    /happened so far/i,
    /on mobile is now live/i,
    /is now live on mobile/i,
    /join us live/i,
    /weekly progress update/i,
    /weekly update/i,
    /binance square/i,
    /earlier this week/i,
    /last week/i,
    /subscribe now/i,
    / amid /i,
    /apply now/i,
    /has surged over/i,
    /available to claim/i,
    /brought to you by/i,
    /apply here/i,
    /just bought/i,
    /just purchased/i,
    /just sold/i,
    /a whale bought/i,
    /a whale sold/i,
    /surges after/i,
    /weekly surge/i,
    /hashrate h/i,
    / minted /i,
    /april fool/i,
    /now claimable/i,
    /activity cools/i,
    /airdrop/i,
    /coindesk daily/i,
    /will be speaking/i,
    /town hall/i,
    /nubank/i,
    /exolix/i,
    /bitmart/i,
    /surges\s+\d+(\.\d+)?%/i
  ],
  redCaseSensitive: [
    / AMA /,
    /RESEARCH: /,
    /INSIGHT: /,
    / AMA's /,
    / AMAs /
  ]
};

function shouldForward(text) {
  const snippet150 = text.slice(0, 150);
  const snippet260 = text.slice(0, 260);
  const snippet20 = text.slice(0, 20);
  const snippet10 = text.slice(0, 10);
  let green = false;

  if (FORWARD_FILTERS.green150.some(rx => rx.test(snippet150))) green = true;
  if (!green && FORWARD_FILTERS.green20.some(rx => rx.test(snippet20))) green = true;
  if (!green && FORWARD_FILTERS.green10.some(rx => rx.test(snippet10))) green = true;
  if (!green && FORWARD_FILTERS.greenAllCaps.test(text)) green = true;

  const hasRed =
    FORWARD_FILTERS.redStart.some(rx => rx.test(text)) ||
    FORWARD_FILTERS.red260.some(rx => rx.test(snippet260)) ||
    FORWARD_FILTERS.redCaseSensitive.some(rx => rx.test(snippet260));

  return green && !hasRed;
}
// End of block

// Dependencies
const axios = require('axios');
const http = require('http');
const he = require('he');
const { TwitterApi } = require('twitter-api-v2');
const { createClient } = require('@supabase/supabase-js');
const { WebSocketServer } = require('ws');
const { maintenance24h: maintenance24h } = require('./maintenance24h');
const { maintenance3h: maintenance3h } = require('./maintenance3h');

// Environment vars
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const STREAM_WS_TOKEN = process.env.STREAM_WS_TOKEN; // Token required by WS clients
if (!TWITTER_BEARER_TOKEN || !WEBHOOK_URL || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error(`[${new Date().toISOString()}] Missing required environment variables.`);
  process.exit(0);
}

// Clients
const twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global variables
let streamInstance;
let isShuttingDown = false;
let inactivityInterval;
let softRateLimit = false;
let softRateLimitUntil = null;
let streamStarting = false;
let lastTweetTime = Date.now();
const threadBuffers = new Map();
const THREAD_OPENER_REGEX = /(?<!\d)(?:[01]\.(?=\s)|[01]\/(?=\s)|[01]\/(?:\d+|x)|🧵|\bthread\b|⬇️|🔽|⤵️|↴|↓|👇|(?<!\bcomment\s)(?<!\bvote\s)\bbelow\b)/i;

console.log(`[${new Date().toISOString()}] Service starting, PID: ${process.pid}`);

// HTTP server (health + maintenance + inbound webhook); named instance so WS can share the port
const server = http.createServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      time: new Date().toISOString(),
      memoryMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
      buffers: threadBuffers.size,
      lastTweet: new Date(lastTweetTime).toISOString(),
    }));
  } else if (req.url === '/maintenance24h') {
    maintenance24h(supabase)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('maintenance24h triggered.\n');
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error triggering maintenance24h: ${err.message}\n`);
      });
  } else if (req.url === '/maintenance3h') {
    maintenance3h(supabase)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('maintenance3h triggered.\n');
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error triggering maintenance3h: ${err.message}\n`);
      });
  } else if (req.url === '/incoming' && req.method === 'POST') {
    // ← new inbound‐webhook endpoint
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const timestamp = parsed.timestamp || new Date().toISOString();
        const rawXId = parsed.xId;
        const authorId = (typeof rawXId === 'string' && rawXId.trim() !== '') ? rawXId : 'Webhook'; // Make it 'Webhook' if is not given or if it is ""
        const conversationId = parsed.conversationId;
        const tweetId = parsed.tweetId;
        const text = parsed.text;

        // construct a “fake” tweet
        const tweet = {
          id: tweetId.toString(),
          author_id: authorId,
          conversation_id: conversationId.toString(),
          created_at: timestamp,
          text,
          _isWebhook: true   // flag to skip thread logic
        };

        // minimal includes block so forwardTweet can run
        const includes = {
          users: [{
            id: authorId,
            username: authorId
          }],
          media: [],
          tweets: []
        };

        console.log(`[${new Date().toISOString()}] Simulated tweet ${tweet.id} via webhook`);
        forwardTweet(tweet, includes);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', message: 'Simulated tweet processed' }));
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Incoming‐webhook error:`, err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid payload' }));
      }
    });
    return;
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kiosuku OK\n');
  }
});

server.listen(process.env.PORT || 8080, () => {
  const port = process.env.PORT || 8080;
  console.log(`[${new Date().toISOString()}] Health/WS server running on port ${port}`);
});

// --- WebSocket server (low-latency broadcast) ---
let wss = null;

function extractWsToken(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const qToken = url.searchParams.get('token') || url.searchParams.get('auth') || url.searchParams.get('t');
    if (qToken) return qToken;

    const hdrAuth = req.headers['authorization'];
    if (hdrAuth && /^bearer\s+/i.test(hdrAuth)) return hdrAuth.replace(/^bearer\s+/i, '').trim();

    const hdrToken = req.headers['x-auth-token'] || req.headers['x-token'];
    if (typeof hdrToken === 'string' && hdrToken.trim() !== '') return hdrToken.trim();
  } catch { }
  return null;
}

if (!STREAM_WS_TOKEN) {
  console.warn(`[${new Date().toISOString()}] STREAM_WS_TOKEN not set. WS endpoint is DISABLED.`);
} else {
  wss = new WebSocketServer({
    server,
    path: '/stream',
    perMessageDeflate: false,
    verifyClient: (info, done) => {
      try {
        const token = extractWsToken(info.req);
        if (token && token === STREAM_WS_TOKEN) return done(true);
        return done(false, 401, 'Unauthorized');
      } catch (e) {
        return done(false, 400, 'Bad Request');
      }
    }
  });

  wss.on('connection', (ws, request) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] WS client error:`, err?.message || err);
    });
    ws.on('close', (code) => {
      console.log(`[${new Date().toISOString()}] WS client disconnected (${code})`);
    });
    console.log(`[${new Date().toISOString()}] WS client connected from ${request.socket.remoteAddress}`);
  });

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { }
    });
  }, WS_PING_INTERVAL_MS);

  wss.on('close', () => clearInterval(pingInterval));
}

function broadcastToWsClients(message) {
  if (!wss) return; // WS disabled
  const data = JSON.stringify(message);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) { // OPEN
      try { ws.send(data); } catch { }
    }
  });
}

// Helper: select prioritized media and extract fields
function getMediaInfo(tweet, includes) {
  const mediaKeys = tweet.attachments?.media_keys || [];
  const mediaItems = mediaKeys
    .map(key => includes.media?.find(m => m.media_key === key))
    .filter(Boolean);

  const selected = mediaItems.find(m => m.type === 'photo')
    || mediaItems.find(m => m.type === 'video')
    || mediaItems.find(m => m.type === 'animated_gif')
    || null;

  const mediaText = selected?.alt_text || '';
  const mediaUrl = selected?.url || selected?.preview_image_url || '';
  return { mediaText, mediaUrl };
}

// --- NEW HELPERS: detect non-image URLs for specific sources ---
function isImageUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    // Common image file extensions
    if (/\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|svg)(?:$|\?|#)/i.test(path)) return true;

    // Known Twitter/X image hosts & short image links
    if (host === 'pbs.twimg.com' || host === 'pic.twitter.com' || host === 'pic.x.com') return true;

    return false;
  } catch {
    return false;
  }
}

function tweetContainsNonImageUrl(tweet) {
  const urls = tweet?.entities?.urls || [];
  if (!urls.length) return false;

  // If ANY url is not an image, return true (meaning: contains a non-image link)
  return urls.some(u => {
    const href = u?.expanded_url || u?.unwound_url || u?.url || '';
    if (!href) return false;
    try {
      const h = new URL(href).hostname.toLowerCase();
      if (h.endsWith('x.com') || h.endsWith('twitter.com')) return false; // ignore X status links
    } catch { }
    return !isImageUrl(href);
  });
}
// --- END NEW HELPERS ---

function forceFullRestart() {
  console.log(`[${new Date().toISOString()}] Forcing container restart`);
  process.exit(1);
}

function storeTweet(data, retryCount = 0) {
  supabase
    .from('posts')
    .insert([data])
    .then(({ error }) => {
      if (error) {
        console.error(
          `[${new Date().toISOString()}] Supabase insert error for post ${data.post_id}: ${error.message}`
        );
        if (retryCount < 3) {
          const delay = (retryCount + 1) * 2000; // exponential back-off
          console.log(
            `[${new Date().toISOString()}] Retrying insert for post ${data.post_id} in ${delay}ms (attempt ${retryCount + 1})`
          );
          setTimeout(() => storeTweet(data, retryCount + 1), delay);
        }
      }
    })
    .catch(err => {
      console.error(
        `[${new Date().toISOString()}] Supabase insert exception for post ${data.post_id}: ${err.message}`
      );
    });
}

function getFullTweetText(tweet, includes) {
  let text = tweet.note_tweet?.text ?? tweet.text;
  text = he.decode(text); // Decode *all* HTML entities (&amp;, &lt;, &gt;, &quot;, &#39;, etc.)
  (tweet.entities?.urls || []).forEach(({ url, display_url }) => {
    if (!display_url.includes('…')) {
      text = text.replace(url, display_url);
    }
  });

  // Only for root tweets, incorporate quoted/retweeted referenced tweets
  if (tweet.id === tweet.conversation_id) {
    tweet.referenced_tweets?.forEach(ref => {
      const refTweet = includes.tweets.find(t => t.id === ref.id);
      if (!refTweet) return;
      let refText = refTweet.note_tweet?.text ?? refTweet.text;
      refText = he.decode(refText); // Decode any entities in the referenced text
      (refTweet.entities?.urls || []).forEach(({ url, display_url }) => {
        if (!display_url.includes('…')) refText = refText.replace(url, display_url);
      });
      const user = includes.users.find(u => u.id === refTweet.author_id);
      const handle = user?.username || 'unknown';
      if (ref.type === 'quoted') text += ` — @${handle} posted: ${refText}`;
      if (ref.type === 'retweeted') text = `@${handle} posted: ${refText}`;
    });
  }

  // Append article title and preview_text if present
  if (tweet.article && Object.keys(tweet.article).length > 0) {
    const title = tweet.article.title || '';
    const preview = tweet.article.preview_text || '';
    if (title || preview) {
      text += ` ${title} ${preview}…`;
    }
  }

  // Removes http/https links and pic.x.com links along with preceding spaces but it doesn't remove statuses (tweet links), replaces new line with space, replaces &amp; with &, and finally turns any succession of multiple spaces into 1 space max.
  return text
    // .replace(/ ?(?:https?:\/\/(?!\S*\/status\/)\S+|pic\.x\.com\/\S+)/g, '') // This was the old version. Keeping for now in case the new version below breaks.
    .replace(/ ?(?:https?:\/\/(?![^\/]+\/status\/)\S+|pic\.x\.com\/\S+)/g, '')
    .replace(/\n/g, ' ')
    .replace(/ {2,}/g, ' ');
}

async function forwardTweet(tweet, includes) {
  if (!tweet || !includes || !includes.users) {
    console.warn(`[${new Date().toISOString()}] Skipping malformed tweet`);
    return;
  }

  // --- NEW: Skip old retweets/quotes, basically it only forwards retweets and quoted tweets if the original was posted less than x minutes ago ---
  const ref = (tweet.referenced_tweets || [])
    .find(r => r.type === 'retweeted' || r.type === 'quoted');
  if (ref) {
    // find the original tweet in includes
    const original = includes.tweets.find(t => t.id === ref.id);
    if (original && tweet.created_at && original.created_at) {
      const nowMs = new Date(tweet.created_at).getTime();
      const origMs = new Date(original.created_at).getTime();
      if (nowMs - origMs > RETWEET_WINDOW_MS) {
        console.log(
          `[${new Date().toISOString()}] Skipping ${ref.type} ${tweet.id} ` +
          `(original ${ref.id} is older than ${Math.round(RETWEET_WINDOW_MS / 60000)} min)`
        );
        return;
      }
    }
  }
  // --- END NEW LOGIC ---

  const user = includes.users.find(u => u.id === tweet.author_id);
  const username = user?.username ?? 'unknown';

  // --- NEW RULE: Skip tweets from certain accounts with any non-image URL ---
  const uname = (username || '').toLowerCase();
  if ((uname === 'zerohedge' || uname === 'disclosetv' || uname === 'cryptoslate' || uname === 'theblock__') && tweetContainsNonImageUrl(tweet)) {
    console.log(`[${new Date().toISOString()}] Skipping @${username} tweet ${tweet.id} due to non-image link`);
    return;
  }
  // --- END NEW RULE ---

  const text = getFullTweetText(tweet, includes);
  if (text.trim().startsWith('@') && !/^@\S+\s+posted:\s*/.test(text.trim())) { // The last part makes sure the text doesn't start with "@someone posted: "
    // console.log(`[${new Date().toISOString()}] Skipping non-retweet @ tweet ${tweet.id}`);
    return;
  }

  const urls = tweet.entities?.urls || [];
  let expandedUrl = '';
  if (urls.length) {
    const nonX = urls.filter(u => {
      try { return !new URL(u.expanded_url).hostname.endsWith('x.com'); }
      catch { return true; }
    });
    const pick = nonX.length ? nonX : urls;
    expandedUrl = pick.reduce((a, b) => b.expanded_url.length > a.expanded_url.length ? b : a).expanded_url;
  }

  const payload = {
    timestamp: tweet.created_at,
    username,
    tweetId: tweet.id,
    conversationId: tweet.conversation_id,
    tweetText: text,
    tweetExpandedURL: expandedUrl,
  };

  const { mediaText, mediaUrl } = getMediaInfo(tweet, includes);

  const insertData = {
    post_id: tweet.id,
    post_timestamp: tweet.created_at,
    fetch_timestamp: new Date().toISOString(),
    account: username,
    // conversation_id: tweet.conversation_id,
    post_text: text
  };
  if (expandedUrl) insertData.page_url = expandedUrl; // Only if it is not ""
  if (mediaText) insertData.scraped_media = mediaText; // Only if it is not ""
  if (mediaUrl) insertData.media_url = mediaUrl; // Only if it is not ""

  // set post_type for webhook vs stream
  if (tweet._isWebhook) {
    insertData.type = 'Webhook';
  } else {
    const type = getTweetType(tweet, 0);
    if (type) insertData.type = type;
  }

  storeTweet(insertData); // Supabase write

  // Broadcast to WS clients (low-latency)
  broadcastToWsClients({
    type: 'post',
    source: 'TWEET',
    id: tweet.id,
    content: text,
    author: username,
    url: expandedUrl,
    createdAt: tweet.created_at
  });

  const isRepost = insertData.type === 'Repost'; // Needed because !ref does not always work
  const isQuoted = insertData.type?.startsWith('Quote'); // Needed because !ref does not always work
  if (!isRepost && !isQuoted && !ref && shouldForward(text)) {
    axios.post(WEBHOOK_URL, payload)
      .catch(err => console.error(`[${new Date().toISOString()}] Webhook error:`, err.response?.data || err.message));
  }
}

async function flushThread(conversationId) {
  const buf = threadBuffers.get(conversationId);
  if (!buf) return;
  clearTimeout(buf.flushTimeout);
  clearTimeout(buf.expireTimeout);

  buf.tweets.sort((a, b) => BigInt(a.tweet.id) < BigInt(b.tweet.id) ? -1 : 1);
  const merged = buf.tweets.map(({ tweet, includes }) => getFullTweetText(tweet, includes)).join(' ');
  const first = buf.tweets[0];
  const user = first.includes.users.find(u => u.id === first.tweet.author_id);
  const name = user?.username ?? 'unknown';

  // --- NEW RULE: Skip threads from certain accounts if root contains a non-image URL ---
  const uname = (name || '').toLowerCase();
  if ((uname === 'zerohedge' || uname === 'disclosetv' || uname === 'cryptoslate' || uname === 'theblock__') && tweetContainsNonImageUrl(first.tweet)) {
    console.log(`[${new Date().toISOString()}] Skipping thread ${conversationId} from @${name} due to non-image link`);
    threadBuffers.delete(conversationId);
    return;
  }
  // --- END NEW RULE ---

  // Extract expanded URL from first tweet
  const urls = first.tweet.entities?.urls || [];
  let expandedUrl = '';
  if (urls.length) {
    const nonX = urls.filter(u => {
      try { return !new URL(u.expanded_url).hostname.endsWith('x.com'); }
      catch { return true; }
    });
    const pick = nonX.length ? nonX : urls;
    expandedUrl = pick.reduce((a, b) => b.expanded_url.length > a.expanded_url.length ? b : a).expanded_url;
  }

  //const isThread = buf.tweets.length > 1;

  const payload = {
    timestamp: first.tweet.created_at,
    username: name,
    tweetId: conversationId,
    conversationId,
    tweetText: merged,
    tweetExpandedURL: expandedUrl
  };

  const { mediaText, mediaUrl } = getMediaInfo(first.tweet, first.includes);

  const insertData = {
    post_id: conversationId,
    post_timestamp: first.tweet.created_at,
    fetch_timestamp: new Date().toISOString(),
    account: name,
    // conversation_id: conversationId,
    post_text: merged
  };
  if (expandedUrl) insertData.page_url = expandedUrl; // Only if it is not ""
  if (mediaText) insertData.scraped_media = mediaText; // Only if it is not ""
  if (mediaUrl) insertData.media_url = mediaUrl; // Only if it is not ""

  const type = getTweetType(first.tweet, buf.tweets.length);
  if (type) insertData.type = type;

  storeTweet(insertData); // Supabase db write
  console.log(`[${new Date().toISOString()}] Thread ${conversationId} from @${name}`);

  // Broadcast to WS clients (low-latency)
  broadcastToWsClients({
    type: 'post',
    source: 'TWEET',
    id: conversationId,
    content: merged,
    author: name,
    url: expandedUrl,
    createdAt: first.tweet.created_at
  });

  const isRepost = type === 'Repost';
  const isQuoted = type?.startsWith('Quote');
  if (!isRepost && !isQuoted && shouldForward(merged)) {
    axios.post(WEBHOOK_URL, payload)
      .catch(err => console.error(`[${new Date().toISOString()}] Webhook error:`, err.response?.data || err.message));
  }

  threadBuffers.delete(conversationId);
}

function handleTweet(tweet, includes) {
  const convId = tweet.conversation_id;
  const isRoot = convId === tweet.id;
  const text = tweet.note_tweet?.text || tweet.text;
  const isThreadOpener = THREAD_OPENER_REGEX.test(text) || text.endsWith(':');

  if (threadBuffers.has(convId)) {
    const buf = threadBuffers.get(convId);
    buf.tweets.push({ tweet, includes });

    if (buf.tweets.length >= MAX_TWEETS_PER_THREAD) {
      flushThread(convId);
      return;
    }
    clearTimeout(buf.flushTimeout);
    buf.flushTimeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
  } else if (isRoot && isThreadOpener) {
    const flushTimeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
    const expireTimeout = setTimeout(() => {
      console.warn(`[${new Date().toISOString()}] Expiring old thread buffer: ${convId}`);
      clearTimeout(flushTimeout);
      clearTimeout(expireTimeout);
      threadBuffers.delete(convId);
    }, THREAD_EXPIRATION_MS);

    threadBuffers.set(convId, {
      tweets: [{ tweet, includes }],
      flushTimeout,
      expireTimeout
    });
  } else if (!isRoot && !threadBuffers.has(convId)) { // Skip any non-root tweet that isn't part of an existing thread buffer (basically skipping replies)
    return;
  } else {
    forwardTweet(tweet, includes); // Root tweet that isn’t thread-opener → treat as standalone
  }
}

async function startStream() {
  if (streamInstance) return;

  inactivityInterval = setInterval(() => {
    if (Date.now() - lastTweetTime > INACTIVITY_TIMEOUT) {
      console.warn(`[${new Date().toISOString()}] No tweets in >= 120 minutes. Restarting.`);
      clearInterval(inactivityInterval);
      forceFullRestart();
    }
  }, 600000);

  streamInstance = await twitterClient.v2.searchStream({
    'tweet.fields': 'created_at,conversation_id,note_tweet,referenced_tweets,entities,article,attachments',
    'user.fields': 'username',
    'media.fields': 'media_key,type,url,preview_image_url,alt_text',
    expansions: 'author_id,referenced_tweets.id,attachments.media_keys'
  });

  if (!streamInstance || !streamInstance[Symbol.asyncIterator]) {
    throw new Error('Invalid stream instance - not async iterable.');
  }

  console.log(`[${new Date().toISOString()}] Connected to Twitter stream`);
  lastTweetTime = Date.now();

  try {
    for await (const { data, includes } of streamInstance) {
      lastTweetTime = Date.now();
      const userLog = includes?.users?.[0]?.username ?? 'unknown';
      console.log(`[${new Date().toISOString()}] Tweet ${data.id} from @${userLog}`);
      setImmediate(() => {
        try {
          handleTweet(data, includes);
        } catch (err) {
          console.error(
            `[${new Date().toISOString()}] Error processing tweet ${data.id}:`,
            err, err.stack
          );
        }
      });
    }
  } finally {
    console.warn(`[${new Date().toISOString()}] Stream ended. Cleaning up.`);
    clearInterval(inactivityInterval);
    streamInstance?.destroy?.();
    streamInstance = null;
  }
}

async function startStreamSafe() {
  if (streamStarting) {
    console.warn(`[${new Date().toISOString()}] Stream start already in progress, skipping.`);
    return;
  }
  streamStarting = true;
  try {
    await startStream();
  } finally {
    streamStarting = false;
  }
}

async function runStream() {
  let reconnectDelay = 600000; // 10 min
  const maxDelay = 120 * 60 * 1000; // 2 hours
  let attempts = 0;
  const maxAttempts = 10;

  while (!isShuttingDown && attempts < maxAttempts) {
    // Destroy previous stream before attempting to reconnect
    if (streamInstance) {
      console.log(`[${new Date().toISOString()}] Destroying previous stream before reconnecting.`);
      streamInstance.destroy();
      streamInstance = null;
    }

    // 💡 Soft rate limit mode - throttle retries for 15 min
    if (softRateLimit) {
      const remaining = softRateLimitUntil ? ((softRateLimitUntil - Date.now()) / 1000).toFixed(0) : 'unknown';
      console.warn(`[${new Date().toISOString()}] Soft rate limit active. Sleeping 60s. (${remaining}s left)`);
      await new Promise(r => setTimeout(r, 60000));
      continue;
    }

    attempts++;
    console.log(`[${new Date().toISOString()}] Stream attempt #${attempts}`);

    let startError = null;
    try {
      await startStreamSafe();
      reconnectDelay = 30000;
      attempts = 0;
      break;  // ← stop the retry loop on success
    } catch (err) {
      startError = err;
    }

    if (startError) {
      const now = new Date().toISOString();
      const status = startError.response?.status;
      console.error(
        `[${now}] Stream error (${status || startError.code || startError.name}): ${startError.message}`,
        startError,
        startError.stack
      );
      streamInstance?.destroy?.();
      streamInstance = null;

      if (status === 429) {
        const headers = startError.response?.headers || {};
        const reset = parseInt(headers['x-rate-limit-reset'], 10);
        const nowSec = Math.floor(Date.now() / 1000);
        const wait = Math.max((reset || nowSec + 60) - nowSec, 60);
        const backoffUntil = Date.now() + 15 * 60 * 1000;

        console.warn(`[${now}] Twitter 429. Waiting ${wait}s, then entering soft rate limit until ${new Date(backoffUntil).toISOString()}`);
        if (!softRateLimit) {
          softRateLimit = true;
          softRateLimitUntil = backoffUntil;
          console.warn(`[${now}] Activating soft rate limit until ${new Date(backoffUntil).toISOString()}`);
          setTimeout(() => {
            softRateLimit = false;
            softRateLimitUntil = null;
            console.log(`[${new Date().toISOString()}] Soft rate limit cleared.`);
          }, 15 * 60 * 1000);
        }
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }

      if (status === 409) {
        const delay = Math.min(reconnectDelay * 2, 30 * 60 * 1000); // Max 30 mins
        console.warn(`[${now}] Twitter 409 Conflict. Another stream is already active. Waiting ${delay / 1000}s before retrying...`);
        await new Promise(r => setTimeout(r, delay));
        reconnectDelay = delay;
        continue;
      }

      if (status === 503) {
        const delay = reconnectDelay;
        console.warn(`[${now}] Twitter 503 Unavailable. Sleeping ${(delay / 1000).toFixed(0)}s before retrying.`);
        await new Promise(r => setTimeout(r, delay));
        reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
        continue;
      }

      if (startError.code === 'TooManyConnections') {
        console.warn(`[${now}] Too many connections. Backing off.`);
      }

      console.warn(`[${now}] Unknown stream error. Applying backoff.`);

      console.log(`[${now}] Retry in ${reconnectDelay / 1000}s`);
      await new Promise(r => setTimeout(r, reconnectDelay));
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
    }

    if (attempts >= maxAttempts) {
      console.error(`[${new Date().toISOString()}] Max attempts reached. Restarting.`);
      forceFullRestart();
    }
  }
}

function getTweetType(tweet, bufLength = 0) {
  // 0) Article override
  if (tweet.article && Object.keys(tweet.article).length > 0) {
    return 'Article';
  }

  const refs = tweet.referenced_tweets?.map(r => r.type) || [];
  const isRetweet = refs.includes('retweeted');
  const isQuote = refs.includes('quoted');
  const isReply = refs.includes('replied_to');
  const text = tweet.note_tweet?.text || tweet.text;
  const isOpener = THREAD_OPENER_REGEX.test(text);

  // 1) A tweet that is both a quote and a reply
  if (isQuote && isReply) {
    return 'Quote reply';
  }

  // 2) Pure retweet
  if (isRetweet) {
    return 'Repost';
  }

  // 3) Quoted thread (or failed quoted opener)
  if (isQuote && isOpener) {
    return bufLength > 1 ? 'Quote thread' : 'Quote*';
  }

  // 4) Standalone quote
  if (isQuote) {
    return 'Quote';
  }

  // 5) Standalone reply
  if (isReply) {
    return 'Reply';
  }

  // 6) Non-quoted thread vs failed opener
  if (isOpener) {
    return bufLength > 1 ? 'Thread' : 'Post*';
  }

  // 7) Default → let DB default to Post
  return undefined;
}

// Graceful shutdown
function shutdown() {
  isShuttingDown = true;
  console.log(`[${new Date().toISOString()}] Shutdown signal received`);
  streamInstance?.destroy();
  clearInterval(inactivityInterval);
  process.exit(0);
}

process.on('SIGTERM', () => {
  console.warn(`[${new Date().toISOString()}] ⚠️ Received SIGTERM from Railway`);
  shutdown();
});
process.on('SIGINT', shutdown);
process.on('uncaughtException', err => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, err);
});
process.on('unhandledRejection', reason => {
  console.error(`[${new Date().toISOString()}] Unhandled Rejection:`, reason);
});

// 🆕 Boot delay + run loop
(async () => {
  console.log(`[${new Date().toISOString()}] Boot delay: waiting 5s before starting stream...`);
  await new Promise(r => setTimeout(r, 5000)); // ⏳ Delay to avoid cold-start 429 from Twitter

  while (true) {
    try {
      await runStream();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] runStream error:`, err);
    }
    console.log(`[${new Date().toISOString()}] Restarting runStream in 10s...`);
    await new Promise(r => setTimeout(r, 10000));
  }
})();
