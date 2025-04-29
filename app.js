const { TwitterApi } = require('twitter-api-v2');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const http = require('http');
let softRateLimitUntil = null;
let streamStarting = false;

// Load env vars
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!TWITTER_BEARER_TOKEN || !WEBHOOK_URL || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error(`[${new Date().toISOString()}] Missing required environment variables.`);
  process.exit(1);
}

// Clients
const twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Globals
let streamInstance;
let isShuttingDown = false;
let inactivityInterval;
let softRateLimit = false;

const INACTIVITY_TIMEOUT = 90 * 60 * 1000;
const WAIT_FOR_THREAD_MS = 6000;
const MAX_TWEETS_PER_THREAD = 20;
let lastTweetTime = Date.now();
const threadBuffers = new Map();

console.log(`[${new Date().toISOString()}] Service starting, PID: ${process.pid}`);

// Health check server
http.createServer((req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      time: new Date().toISOString(),
      memoryMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
      buffers: threadBuffers.size,
      lastTweet: new Date(lastTweetTime).toISOString(),
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('x-filtered-stream OK\n'); // This line keeps Railway happy
  }
}).listen(8080, () => {
  console.log(`[${new Date().toISOString()}] Health check server running on port 8080`);
});

// Memory logging
setInterval(() => {
  const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
  console.log(`[${new Date().toISOString()}] Memory: ${mem} MB | Buffers: ${threadBuffers.size}`);
}, 300000);

// Thread buffer expiration
setInterval(() => {
  const now = Date.now();
  for (const [convId, buf] of threadBuffers) {
    const firstTweetTime = buf?.tweets?.[0]?.tweet?.created_at;
    if (!firstTweetTime) continue;
    const ageMs = now - new Date(firstTweetTime).getTime();
    if (ageMs > 4 * 60 * 60 * 1000) { // 4 hours
      console.warn(`[${new Date().toISOString()}] Expiring old thread buffer: ${convId}`);
      threadBuffers.delete(convId);
    }
  }
}, 3600000); // Every 1 hour

function forceFullRestart() {
  console.log(`[${new Date().toISOString()}] Forcing container restart`);
  process.exit(1);
}

function getFullTweetText(tweet, includes) {
  let text = tweet.note_tweet?.text ?? tweet.text;
  (tweet.entities?.urls || []).forEach(({ url, display_url }) => {
    if (!display_url.includes('…')) {
      text = text.replace(url, display_url);
    }
  });

  tweet.referenced_tweets?.forEach(ref => {
    const refTweet = includes.tweets.find(t => t.id === ref.id);
    if (!refTweet) return;
    let refText = refTweet.note_tweet?.text ?? refTweet.text;
    (refTweet.entities?.urls || []).forEach(({ url, display_url }) => {
      if (!display_url.includes('…')) refText = refText.replace(url, display_url);
    });
    const user = includes.users.find(u => u.id === refTweet.author_id);
    const handle = user?.username || 'unknown';
    if (ref.type === 'quoted') text += ` [quoted @${handle}]${refText}[/quoted]`;
    if (ref.type === 'retweeted') text = `RT @${handle} ${refText}`;
  });

  // NEW: Append article title and preview_text if present
  if (tweet.article) {
    const title = tweet.article.title || '';
    const preview = tweet.article.preview_text || '';
    text += ` ${title} ${preview}`;
  }

  return text.replace(/\n/g, ' ');
}

async function forwardTweet(tweet, includes) {
  if (!tweet || !includes || !includes.users) {
    console.warn(`[${new Date().toISOString()}] Skipping malformed tweet`);
    return;
  }

  const user = includes.users.find(u => u.id === tweet.author_id);
  const username = user?.username ?? 'unknown';
  const text = getFullTweetText(tweet, includes);
  if (text.trim().startsWith('@')) {
    console.log(`[${new Date().toISOString()}] Skipping @ tweet ${tweet.id}`);
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

  supabase.from('Posts').insert([{
    post_id: tweet.id,
    post_timestamp: tweet.created_at,
    added_timestamp: new Date().toISOString(),
    x_id: username,
    conversation_id: tweet.conversation_id,
    text,
    expanded_url: expandedUrl
  }]).then(({ error }) => {
    if (error) console.error(`[${new Date().toISOString()}] Supabase error: ${error.message}`);
    else console.log(`[${new Date().toISOString()}] Supabase OK for tweet ${tweet.id}`);
  });

  axios.post(WEBHOOK_URL, payload)
    .then(() => console.log(`[${new Date().toISOString()}] Webhook OK for tweet ${tweet.id}`))
    .catch(err => console.error(`[${new Date().toISOString()}] Webhook error:`, err.response?.data || err.message));
}

async function flushThread(conversationId) {
  const buf = threadBuffers.get(conversationId);
  if (!buf) return;
  clearTimeout(buf.timeout);

  buf.tweets.sort((a, b) => BigInt(a.tweet.id) < BigInt(b.tweet.id) ? -1 : 1);
  const merged = buf.tweets.map(({ tweet, includes }) => getFullTweetText(tweet, includes)).join(' ');
  const first = buf.tweets[0];
  const user = first.includes.users.find(u => u.id === first.tweet.author_id);
  const name = user?.username ?? 'unknown';

  const payload = {
    timestamp: first.tweet.created_at,
    username: name,
    tweetId: conversationId,
    conversationId,
    tweetText: merged,
    tweetExpandedURL: ''
  };

  supabase.from('Posts').insert([{
    post_id: conversationId,
    post_timestamp: first.tweet.created_at,
    added_timestamp: new Date().toISOString(),
    x_id: name,
    conversation_id: conversationId,
    text: merged,
    expanded_url: '',
    is_possible_thread: true
  }]).then(({ error }) => {
    if (error) console.error(`[${new Date().toISOString()}] Supabase thread error: ${error.message}`);
    else console.log(`[${new Date().toISOString()}] Thread logged: ${conversationId}`);
  });

  axios.post(WEBHOOK_URL, payload)
    .then(() => console.log(`[${new Date().toISOString()}] Thread webhook OK for ${conversationId}`))
    .catch(err => console.error(`[${new Date().toISOString()}] Thread webhook error:`, err.message));

  threadBuffers.delete(conversationId);
}

function handleTweet(tweet, includes) {
  const convId = tweet.conversation_id;
  const isRoot = convId === tweet.id;
  const text = tweet.note_tweet?.text || tweet.text;
  const isThreadOpener = /(?:1\/(?:\d+|x)|🧵|\bthread\b|👇)/i.test(text);

  if (threadBuffers.has(convId)) {
    const buf = threadBuffers.get(convId);
    buf.tweets.push({ tweet, includes });
    if (buf.tweets.length >= MAX_TWEETS_PER_THREAD) {
      console.warn(`[${new Date().toISOString()}] Thread ${convId} exceeded max. Flushing.`);
      flushThread(convId);
      return;
    }
    clearTimeout(buf.timeout);
    buf.timeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
  } else if (isRoot && isThreadOpener) {
    const timeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
    threadBuffers.set(convId, { tweets: [{ tweet, includes }], timeout });
  } else {
    forwardTweet(tweet, includes);
  }
}

async function startStream() {
  if (streamInstance) return;

  inactivityInterval = setInterval(() => {
    if (Date.now() - lastTweetTime > INACTIVITY_TIMEOUT) {
      console.warn(`[${new Date().toISOString()}] No tweets in 90 minutes. Restarting.`);
      clearInterval(inactivityInterval);
      forceFullRestart();
    }
  }, 60000);

  streamInstance = await twitterClient.v2.searchStream({
    'tweet.fields': 'created_at,conversation_id,note_tweet,referenced_tweets,entities,article',
    'user.fields': 'username',
    expansions: 'author_id,referenced_tweets.id'
  });

  console.log(`[${new Date().toISOString()}] Connected to Twitter stream`);
  lastTweetTime = Date.now();

  for await (const { data, includes } of streamInstance) {
    lastTweetTime = Date.now();
    const userLog = includes?.users?.[0]?.username ?? 'unknown';
    console.log(`[${new Date().toISOString()}] Tweet ${data.id} from @${userLog}`);
    handleTweet(data, includes);
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
  let reconnectDelay = 30000;
  const maxDelay = 300000;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isShuttingDown && attempts < maxAttempts) {
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
    } catch (err) {
      startError = err;
    }

    if (startError) {
      const now = new Date().toISOString();
      const status = startError.response?.status;
      console.error(`[${now}] Stream error (${status || startError.code || startError.name}): ${startError.message}`);

      if (status === 429) {
        // Handle 429 Rate Limit
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
        const base = 5 * 60 * 1000; // 5 minutes
        const jitter = Math.floor(Math.random() * 2 * 60 * 1000); // + up to 2 mins
        const delay = base + jitter;
        console.warn(`[${now}] Twitter 503 Unavailable. Sleeping ${(delay / 1000).toFixed(0)}s before retrying.`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (startError.code === 'TooManyConnections') {
        console.warn(`[${now}] Too many connections. Backing off.`);
      }

      console.warn(`[${now}] Unknown stream error. Applying backoff.`); // << added clarity

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

// 💓 Keep-alive heartbeat
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Heartbeat: alive | Last tweet seen at ${new Date(lastTweetTime).toISOString()}`);
}, 60 * 60 * 1000); // 1 hour

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
