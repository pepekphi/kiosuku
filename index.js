// Settings
const PAUSE_MODE = false; // Set to true to pause the server
const INACTIVITY_TIMEOUT = 120 * 60 * 1000;
const WAIT_FOR_THREAD_MS = 7600;
const MAX_TWEETS_PER_THREAD = 8;

// Dependencies
const axios = require('axios');
const http = require('http');
const { TwitterApi } = require('twitter-api-v2');
const { createClient } = require('@supabase/supabase-js');
const { maintenance24h: maintenance24h } = require('./maintenance24h');
const { maintenance3h: maintenance3h } = require('./maintenance3h');

// Environment variables
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Clients
let twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN, {
  requestOptions: {
    headers: {
      // identify your app version in every request
      'User-Agent': 'kiosuku2/2.0.0'
    }
  }
});
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global variables
let streamInstance;
let streamAbortController;   // ← NEW
let isShuttingDown = false;
let inactivityInterval;
let softRateLimit = false;
let softRateLimitUntil = null;
let streamStarting = false;
let lastTweetTime = Date.now();
const threadBuffers = new Map();

// ← NEW: allow us to inspect & kill lingering sockets
const { execSync } = require('child_process');

/**
 * Kill any TIME_WAIT / orphaned TCP connections to X.com (104.244.42.*)
 * Logs any you had open, then you can optionally script kills if needed.
 */
function killOldXConnections() {
  try {
    const out = execSync(
      `lsof -iTCP -sTCP:TIME_WAIT 2>/dev/null | grep 104.244.42.`
    ).toString().trim();
    if (out) {
      console.log('[startup] lingering X.com sockets:\n', out);
      // You could parse the PIDs here and kill them if you want:
      out.split('\n').forEach(line => {
        const pid = line.split(/\s+/)[1];
        process.kill(pid, 'SIGTERM');
      });
    } else {
      console.log('[startup] no lingering X.com sockets found');
    }
  } catch {
    console.log('[startup] no lingering X.com sockets or insufficient permissions');
  }
}

if (!TWITTER_BEARER_TOKEN || !WEBHOOK_URL || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error(`[${new Date().toISOString()}] Missing required environment variables.`);
  process.exit(0); // Exit cleanly to prevent Railway from restarting (zero code 0 is needed)
}

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
  } else if (req.url === '/maintenance24h') { // For me or the cron job to trigger maintenance24h with server URL
    maintenance24h(supabase)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('maintenance24h triggered.\n');
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error triggering maintenance24h: ${err.message}\n`);
      });
  } else if (req.url === '/maintenance3h') { // For me or the cron job to trigger maintenance3h with server URL
    maintenance3h(supabase)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('maintenance3h triggered.\n');
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error triggering maintenance3h: ${err.message}\n`);
      });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kiosuku OK\n'); // This line keeps Railway happy
  }
}).listen(8080, () => {
  console.log(`[${new Date().toISOString()}] Health check server running on port 8080`);
});

// Memory logging
/*
setInterval(() => {
  const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
  console.log(`[${new Date().toISOString()}] Memory: ${mem} MB | Buffers: ${threadBuffers.size}`);
}, 300000);
*/

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

function forceFullRestart() {
  console.log(`[${new Date().toISOString()}] Forcing container restart`);
  process.exit(1); // Code 1 means Railway will restart
}

function getFullTweetText(tweet, includes) {
  let text = tweet.note_tweet?.text ?? tweet.text;
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
      (refTweet.entities?.urls || []).forEach(({ url, display_url }) => {
        if (!display_url.includes('…')) refText = refText.replace(url, display_url);
      });
      const user = includes.users.find(u => u.id === refTweet.author_id);
      const handle = user?.username || 'unknown';
      if (ref.type === 'quoted') text += ` [quoted @${handle}]${refText}[/quoted]`;
      if (ref.type === 'retweeted') text = `RT @${handle} ${refText}`;
    });
  }

  // NEW: Append article title and preview_text if present
  if (tweet.article) {
    const title = tweet.article.title || '';
    const preview = tweet.article.preview_text || '';
    if (title || preview) {
      text += ` ${title} ${preview}…`;
    }
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
  if (mediaUrl)  insertData.media_url  = mediaUrl; // Only if it is not ""

  supabase.from('posts').insert([ insertData ])
    .then(({ error }) => {
      if (error) {
        console.error(`[${new Date().toISOString()}] Supabase error: ${error.message}`);
      }
    });

  axios.post(WEBHOOK_URL, payload)
    .then(() => {
      // console.log(`[${new Date().toISOString()}] Webhook OK for tweet ${tweet.id}`);
    })
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

  const isThread = buf.tweets.length > 1;

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
    post_text: merged,
    is_thread: isThread
  };
  if (expandedUrl) insertData.page_url = expandedUrl; // Only if it is not ""
  if (mediaText) insertData.scraped_media = mediaText; // Only if it is not ""
  if (mediaUrl)  insertData.media_url  = mediaUrl; // Only if it is not ""

  supabase.from('posts').insert([ insertData ])
    .then(({ error }) => {
      if (error) {
        console.error(`[${new Date().toISOString()}] Supabase thread error: ${error.message}`);
      } else {
        console.log(`[${new Date().toISOString()}] Thread ${conversationId} from @${name}`);
      }
    });

  axios.post(WEBHOOK_URL, payload)
    // .then(() => console.log(`[${new Date().toISOString()}] Thread webhook OK for ${conversationId}`))
    .catch(err => console.error(`[${new Date().toISOString()}] Thread webhook error:`, err.message));

  threadBuffers.delete(conversationId);
}

function handleTweet(tweet, includes) {
  const convId = tweet.conversation_id;
  const isRoot = convId === tweet.id;
  const text = tweet.note_tweet?.text || tweet.text;
  const isThreadOpener = /(?:[01]\.(?=\s)|[01]\/(?:\d+|x)|🧵|\bthread\b|⬇️|🔽|⤵️|↴|↓|👇|\bbelow\b)/i.test(text);

  if (threadBuffers.has(convId)) { // Already buffering this conversation → append
    const buf = threadBuffers.get(convId);
    buf.tweets.push({ tweet, includes });
    if (buf.tweets.length >= MAX_TWEETS_PER_THREAD) {
      // console.warn(`[${new Date().toISOString()}] Thread ${convId} exceeded max. Flushing.`);
      flushThread(convId);
      return;
    }
    clearTimeout(buf.timeout);
    buf.timeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
  } else if (isRoot && isThreadOpener) { // First tweet of a detected thread → start buffering
    
    const timeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
    threadBuffers.set(convId, { tweets: [{ tweet, includes }], timeout });
  } else if (!isRoot) { // Non-root tweet not part of a buffered thread → drop
    // console.log(`[${new Date().toISOString()}] Skipping non-root tweet ${tweet.id} not in thread buffer`);
    return;
  } else {
    forwardTweet(tweet, includes); // Root tweet that isn’t thread-opener → treat as standalone
  }
}

async function startStream() {
  if (streamInstance) return;

  // Track “last data” to catch missing heartbeats
  let lastHeartbeat = Date.now();

  // Existing inactivity watchdog (120 min without any tweet → full restart)
  inactivityInterval = setInterval(() => {
    if (Date.now() - lastTweetTime > INACTIVITY_TIMEOUT) {
      console.warn(`[${new Date().toISOString()}] No tweets in 120 minutes. Restarting.`);
      clearInterval(inactivityInterval);
      forceFullRestart();
    }
  }, 600000); // Check every 10 minutes

  // New: heartbeat checker (no data for 20 s → reconnect)
  const heartbeatInterval = setInterval(() => {
    // only run when we actually have an active stream
    if (!streamInstance) return;

    if (Date.now() - lastHeartbeat > 20_000) {
      console.warn(`[${new Date().toISOString()}] No heartbeat in 20s → reconnecting`);
      // safely abort if it exists
      streamAbortController?.abort();
      clearInterval(heartbeatInterval);
    }
  }, 5000);

  // Create a fresh controller for this connection
  streamAbortController = new AbortController();

  streamInstance = await twitterClient.v2.searchStream({
    'tweet.fields': 'created_at,conversation_id,note_tweet,referenced_tweets,entities,article,attachments',
    'user.fields': 'username',
    'media.fields': 'media_key,type,url,preview_image_url,alt_text',
    expansions: 'author_id,referenced_tweets.id,attachments.media_keys'
  }, {
    signal: streamAbortController.signal
  });

  // NEW: every time any chunk (tweet or heartbeat newline) arrives,
  // update lastHeartbeat so we know the connection is still alive.
  streamInstance.on('data', () => {
    lastHeartbeat = Date.now();
  });

  // Listen for the socket close so we null out our state immediately
  streamInstance.on('close', () => {
    console.log(`[${new Date().toISOString()}] Stream socket closed`);
    clearInterval(heartbeatInterval);
    streamInstance = null;
    streamAbortController = null;
  });

  console.log(`[${new Date().toISOString()}] Connected to Twitter stream`);
  lastTweetTime = Date.now();

  try {
    for await (const { data, includes } of streamInstance) {
      lastTweetTime = Date.now();
      const userLog = includes?.users?.[0]?.username ?? 'unknown';
      console.log(`[${new Date().toISOString()}] Tweet ${data.id} from @${userLog}`);
      try {
        handleTweet(data, includes);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error inside stream loop:`, err, err.stack);
      }
    }
  } finally {
    console.warn(`[${new Date().toISOString()}] Stream ended. Cleaning up.`);
    clearInterval(inactivityInterval);
    clearInterval(heartbeatInterval);

    if (streamAbortController) {
      streamAbortController.abort();
    }
    streamInstance = null;
    streamAbortController = null;
  }
}

async function startStreamSafe() {
  if (streamStarting) {
    console.warn(`[${new Date().toISOString()}] Stream start already in progress, skipping.`);
    return;
  }
  streamStarting = true;

  // ◆ Refresh client to honor DNS TTL & keep UA header fresh
  twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN, {
    requestOptions: {
      headers: {
        'User-Agent': 'kiosuku/1.0.0'
      }
    }
  });

  // Clean up any lingering stream before opening a new one
  if (streamAbortController) {
    console.log(`[${new Date().toISOString()}] Cleaning up previous stream before reconnecting.`);
    streamAbortController.abort();
    // some streams expose .destroy() instead of .close()
    if (typeof streamInstance?.destroy === 'function') {
      streamInstance.destroy();
    } else if (typeof streamInstance?.close === 'function') {
      streamInstance.close();
    }
    streamInstance = null;
    streamAbortController = null;
  }

  try {
    await startStream();
  } finally {
    streamStarting = false;
  }
}

/**
 * Given an Axios/Twitter‐API error and the attempt count,
 * return the delay (ms) before the next reconnect.
 */
function getNextDelay(error, attempts) {
  // 1) Linear back-off for low-level network errors
  if (error.code && ['ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].includes(error.code)) {
    // attempts*250ms, capped at 16s
    return Math.min(attempts * 250, 16_000);
  }

  const status = error.response?.status;
  const headers = error.response?.headers || {};

  // 2) 429 → use X rate-limit-reset
  if (status === 429) {
    const reset = parseInt(headers['x-rate-limit-reset'], 10);
    const nowSec = Math.floor(Date.now() / 1000);
    const waitSec = Math.max((reset || nowSec + 60) - nowSec, 60);
    return waitSec * 1000;
  }

  // 3) 409 → exponential up to 30m
  if (status === 409) {
    return Math.min(1000 * Math.pow(2, attempts), 30 * 60 * 1000);
  }

  // 4) 503 → 5m + jitter
  if (status === 503) {
    const base = 5 * 60 * 1000;
    const jitter = Math.floor(Math.random() * 2 * 60 * 1000);
    return base + jitter;
  }

  // 5) all other HTTP errors → exponential 60s×2^(n−1), capped at 1h
  const initial = 60 * 1000;         // first retry is now 1 minute
  const maxDelay = 60 * 60 * 1000;   // cap at 1 hour
  return Math.min(initial * Math.pow(2, attempts - 1), maxDelay);
}

async function runStream() {
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
      attempts = 0;
      break;  // ← stop the retry loop on success
    } catch (err) {
      startError = err;
    }

    if (startError) {
      const now = new Date().toISOString();
      const status = startError.response?.status;

      // Fail-fast on authentication errors
      if (status === 401 || status === 403) {
        console.error(
          `[${now}] Authentication error (${status}). ` +
          `Please verify your TWITTER_BEARER_TOKEN; exiting.`
        );
        process.exit(0); // Exit cleanly to prevent Railway from restarting (zero code 0 is needed)
      }
      
      console.error(
        `[${now}] Stream error (${status || startError.code || startError.name}): ${startError.message}`,
        startError,
        startError.stack
      );

      // clean up old connection
      if (streamAbortController) {
        streamAbortController.abort();
      }
      streamInstance = null;
      streamAbortController = null;

      // inside runStream’s catch(startError):
      if (status === 429) {
        const headers = startError.response.headers || {};
        const resetSec = parseInt(headers['x-rate-limit-reset'], 10);
        const nowSec  = Math.floor(Date.now() / 1000);
        // ensure at least 60s if header is missing or in the past
        const waitSec = Math.max((resetSec || nowSec + 60) - nowSec, 60);

        console.warn(
          `[${now}] 429 from Twitter. `
          + `Waiting ${waitSec}s until ${new Date(resetSec * 1000).toISOString()} before reconnect…`
        );
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;  // skip any other backoff logic
      }

      // (no more 429 fallback here—everything else still hits centralized backoff)
      const delayMs = getNextDelay(startError, attempts);
      console.warn(`[${now}] Waiting ${delayMs/1000}s before retrying…`);
      await new Promise(r => setTimeout(r, delayMs));
    
      if (attempts >= maxAttempts) {
        const now = new Date().toISOString();
        console.error(`[${now}] Max attempts reached. Pausing 10m before next try (no full restart).`);
        // long backoff instead of process.exit()
        await new Promise(r => setTimeout(r, 10 * 60 * 1000));
        attempts = 0;
        console.log(`[${new Date().toISOString()}] Resuming stream attempts.`);
        continue;
      }
    }
  }
}

// Graceful shutdown
function shutdown() {
  isShuttingDown = true;
  console.log(`[${new Date().toISOString()}] Shutdown signal received`);
  if (streamAbortController) {
    streamAbortController.abort();
  }
  if (streamInstance) {
    if (typeof streamInstance.destroy === 'function') {
      streamInstance.destroy();
    } else {
      streamInstance.close?.();
    }
  }
  streamInstance = null;
  streamAbortController = null;
  clearInterval(inactivityInterval);
  process.exit(0); // Code 0 means Railway won't restart
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
  if (PAUSE_MODE) {
    console.log(`[${new Date().toISOString()}] PAUSE_MODE enabled → sleeping indefinitely.`);
    // never resolves, so nothing else runs
    await new Promise(() => {});
  }

  // ← NEW: kill any orphaned TCP connections before we open a new one
  killOldXConnections();
  
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
