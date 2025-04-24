const { TwitterApi } = require('twitter-api-v2');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Load environment variables
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const WEBHOOK_URL          = process.env.WEBHOOK_URL;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_KEY         = process.env.SUPABASE_KEY;

// Create clients
const twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN);
const supabase      = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global variables for stream management
let streamInstance;
let isShuttingDown    = false;
let inactivityInterval;

// Define inactivity timeout (90 minutes)
const INACTIVITY_TIMEOUT = 90 * 60 * 1000;
let lastTweetTime       = Date.now();

// THREAD MERGING CONFIG
const WAIT_FOR_THREAD_MS = 6000;
const threadBuffers      = new Map();

// Force full container restart
function forceFullRestart() {
  console.log(`[${new Date().toISOString()}] Forcing full container restart...`);
  process.exit(1);
}

// Build full tweet text (handles note_tweet, URLs, threads)
function getFullTweetText(tweet, includes) {
  let fullText = tweet.note_tweet?.text ?? tweet.text;

  // Expand URLs
  (tweet.entities?.urls || []).forEach(({ url, display_url }) => {
    if (!display_url.includes('…')) {
      fullText = fullText.replace(url, display_url);
    }
  });

  // Handle quoted/retweeted references
  tweet.referenced_tweets?.forEach(ref => {
    const refTweet = includes.tweets.find(t => t.id === ref.id);
    if (!refTweet) return;
    let txt = refTweet.note_tweet?.text ?? refTweet.text;
    (refTweet.entities?.urls || []).forEach(({ url, display_url }) => {
      if (!display_url.includes('…')) txt = txt.replace(url, display_url);
    });
    const user   = includes.users.find(u => u.id === refTweet.author_id);
    const handle = user?.username || 'unknown';
    if (ref.type === 'quoted') {
      fullText += ` [quoted @${handle}]${txt}[/quoted]`;
    } else if (ref.type === 'retweeted') {
      fullText = `RT @${handle} ${txt}`;
    }
  });

  return fullText.replace(/\n/g, ' ');
}

// Forward a single tweet to Supabase + webhook
async function forwardTweet(tweet, includes) {
  const user     = includes.users.find(u => u.id === tweet.author_id);
  const username = user?.username ?? 'unknown';
  const text     = getFullTweetText(tweet, includes);

  if (text.trim().startsWith('@')) {
    console.log(`[${new Date().toISOString()}] Skipping @-reply tweet ${tweet.id}`);
    return;
  }

  // Choose longest non-x.com URL
  const urls = tweet.entities?.urls || [];
  let expandedUrl = '';
  if (urls.length) {
    const nonX = urls.filter(u => {
      try {
        return !new URL(u.expanded_url).hostname.endsWith('x.com');
      } catch { return true; }
    });
    const choose = nonX.length ? nonX : urls;
    expandedUrl = choose.reduce((a, b) => b.expanded_url.length > a.expanded_url.length ? b : a).expanded_url;
  }

  const payload = {
    timestamp:       tweet.created_at,
    username,
    tweetId:         tweet.id,
    conversationId:  tweet.conversation_id,
    tweetText:       text,
    tweetExpandedURL: expandedUrl
  };

  // Supabase insert (fire-and-forget)
  supabase
    .from('Posts')
    .insert([{
      post_id:         tweet.id,
      post_timestamp:  tweet.created_at,
      added_timestamp: new Date().toISOString(),
      x_id:            username,
      conversation_id: tweet.conversation_id,
      text,
      expanded_url:    expandedUrl
    }])
    .then(({ error }) => {
      if (error) console.error(`[${new Date().toISOString()}] Supabase error:`, error.message);
      else console.log(`[${new Date().toISOString()}] Logged tweet ${tweet.id} to Supabase.`);
    });

  // Webhook POST
  axios.post(WEBHOOK_URL, payload)
    .then(() => console.log(`[${new Date().toISOString()}] Forwarded tweet ${tweet.id} to webhook.`))
    .catch(err => console.error(
      `[${new Date().toISOString()}] Webhook error for ${tweet.id}:`,
      err.response?.data || err.message
    ));
}

// Flush a buffered thread
async function flushThread(conversationId) {
  const buf = threadBuffers.get(conversationId);
  if (!buf) return;
  clearTimeout(buf.timeout);

  buf.tweets.sort((a, b) => BigInt(a.tweet.id) < BigInt(b.tweet.id) ? -1 : 1);
  const merged = buf.tweets
    .map(({ tweet, includes }) => getFullTweetText(tweet, includes))
    .join(' ');
  const first  = buf.tweets[0];
  const user   = first.includes.users.find(u => u.id === first.tweet.author_id);
  const name   = user?.username ?? 'unknown';

  const payload = {
    timestamp:       first.tweet.created_at,
    username:        name,
    tweetId:         conversationId,
    conversationId,
    tweetText:       merged,
    tweetExpandedURL: ''
  };

  supabase
    .from('Posts')
    .insert([{
      post_id:             conversationId,
      post_timestamp:      first.tweet.created_at,
      added_timestamp:     new Date().toISOString(),
      x_id:                name,
      conversation_id:     conversationId,
      text:                merged,
      expanded_url:        '',
      is_possible_thread:  true
    }])
    .then(({ error }) => {
      if (error) console.error(`[${new Date().toISOString()}] Supabase thread error:`, error.message);
      else console.log(`[${new Date().toISOString()}] Logged thread ${conversationId}.`);
    });

  axios.post(WEBHOOK_URL, payload)
    .then(() => console.log(`[${new Date().toISOString()}] Forwarded thread ${conversationId}.`))
    .catch(err => console.error(`[${new Date().toISOString()}] Thread webhook error:`, err.message));

  threadBuffers.delete(conversationId);
}

// Decide buffering vs immediate forward
function handleTweet(tweet, includes) {
  const convId      = tweet.conversation_id;
  const isRoot      = convId === tweet.id;
  const text        = tweet.note_tweet?.text || tweet.text;
  const isThreadOp  = /(?:1\/(?:\d+|x)|🧵|\bthread\b|👇)/i.test(text);

  if (threadBuffers.has(convId)) {
    const b = threadBuffers.get(convId);
    b.tweets.push({ tweet, includes });
    clearTimeout(b.timeout);
    b.timeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
  }
  else if (isRoot && isThreadOp) {
    const timeout = setTimeout(() => flushThread(convId), WAIT_FOR_THREAD_MS);
    threadBuffers.set(convId, { tweets: [{ tweet, includes }], timeout });
  }
  else {
    forwardTweet(tweet, includes);
  }
}

// Start streaming + inactivity watchdog
async function startStream() {
  if (streamInstance) {
    console.log(`[${new Date().toISOString()}] Stream already active.`);
    return;
  }

  inactivityInterval = setInterval(() => {
    if (Date.now() - lastTweetTime >= INACTIVITY_TIMEOUT) {
      console.error(`[${new Date().toISOString()}] No tweets for ${INACTIVITY_TIMEOUT/60000} min – restarting.`);
      clearInterval(inactivityInterval);
      forceFullRestart();
    }
  }, 60 * 1000);

  try {
    streamInstance = await twitterClient.v2.searchStream({
      'tweet.fields':      'created_at,conversation_id,note_tweet,referenced_tweets,entities',
      'user.fields':       'username',
      expansions:          'author_id,referenced_tweets.id'
    });
    console.log(`[${new Date().toISOString()}] Connected to Twitter stream.`);
    lastTweetTime = Date.now();

    for await (const { data, includes } of streamInstance) {
      lastTweetTime = Date.now();
      const userLog = includes?.users?.[0]?.username ?? 'unknown';
      console.log(`[${new Date().toISOString()}] New tweet ${data.id} from @${userLog}`);
      handleTweet(data, includes);
    }
  } finally {
    clearInterval(inactivityInterval);
    if (streamInstance?.destroy) {
      try { streamInstance.destroy(); }
      catch (err) { console.error(`[${new Date().toISOString()}] Error destroying stream:`, err); }
    }
    streamInstance = null;
  }
}

// Manage reconnections with backoff
async function runStream() {
  let reconnectDelay = 30 * 1000;
  const maxDelay    = 5 * 60 * 1000;

  while (!isShuttingDown) {
    try {
      await startStream();
      reconnectDelay = 30 * 1000;
    }
    catch (error) {
      const now = new Date().toISOString();
      const status = error.response?.status;
      console.error(`[${now}] Stream error (${status || error.code || error.name}): ${error.message}`);

      if (status === 429) {
        const hdrs = error.response.headers || {};
        const rem  = hdrs['x-rate-limit-remaining'];
        const rst  = parseInt(hdrs['x-rate-limit-reset'], 10);
        console.error(`[${now}] Rate limit info – remaining=${rem}, reset=${rst}`);
        let waitSec = 60;
        if (!isNaN(rst)) {
          const nowSec = Math.floor(Date.now()/1000);
          waitSec = Math.max(rst - nowSec, 60);
        }
        console.log(`[${now}] Waiting ${waitSec} s for rate-limit reset before reconnecting.`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }

      // Too many connections? just log
      if (error.code === 'TooManyConnections') {
        console.error(`[${now}] Too many streaming connections; backing off.`);
      }

      console.log(`[${now}] Reconnecting in ${reconnectDelay/1000} s...`);
      await new Promise(r => setTimeout(r, reconnectDelay));
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
    }
  }
}

// Graceful shutdown
function shutdown() {
  isShuttingDown = true;
  console.log(`[${new Date().toISOString()}] Shutdown initiated.`);
  streamInstance?.destroy();
  clearInterval(inactivityInterval);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

runStream();
