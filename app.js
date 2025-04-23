const { TwitterApi } = require('twitter-api-v2');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Load environment variables
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Create clients
const twitterClient = new TwitterApi(TWITTER_BEARER_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Global variables for stream management
let streamInstance;
let isShuttingDown = false;

// Nostaleur only mode flag: when true, only tweets from username "nostaleur" will be forwarded to the webhook.
// let nostaleurOnly = true;

// Define inactivity timeout (set to 60 minutes)
const INACTIVITY_TIMEOUT = 5400000; // 90 minutes in ms

// Track the last time a tweet was received
let lastTweetTime = Date.now();

// --- THREAD MERGING CONFIG ---
const WAIT_FOR_THREAD_MS = 6000; // x milliseconds debounce per conversation. I saw it can be up to 5 seconds between sub-posts, so I made it 6000 ms for now.
// threadBuffers maps conversationId → { tweets: [{ tweet, includes }], timeout }
const threadBuffers = new Map();
// -----------------------------

// Function to force a full container restart by exiting the process.
function forceFullRestart() {
  console.log("Forcing full container restart...");
  process.exit(1);
}

// Function to build the full tweet text using note_tweet and referenced tweets
function getFullTweetText(tweet, includes) {
  let fullText = tweet.note_tweet && tweet.note_tweet.text ? tweet.note_tweet.text : tweet.text;

  // Replace t.co URLs in the main tweet text with display URLs if available
  // Only replace if the display_url does not contain an ellipsis ("…")
  if (tweet.entities && tweet.entities.urls) {
    tweet.entities.urls.forEach(urlEntity => {
      if (!urlEntity.display_url.includes("…")) {
        fullText = fullText.replace(urlEntity.url, urlEntity.display_url);
      }
    });
  }

  if (tweet.referenced_tweets && includes && includes.tweets) {
    tweet.referenced_tweets.forEach(refTweet => {
      let referencedTweet = includes.tweets.find(t => t.id === refTweet.id);
      if (referencedTweet) {
        let referencedFullText = referencedTweet.note_tweet && referencedTweet.note_tweet.text
          ? referencedTweet.note_tweet.text
          : referencedTweet.text;
        // Replace t.co URLs in referenced tweet text with display URLs if available
        if (referencedTweet.entities && referencedTweet.entities.urls) {
          referencedTweet.entities.urls.forEach(urlEntity => {
            if (!urlEntity.display_url.includes("…")) {
              referencedFullText = referencedFullText.replace(urlEntity.url, urlEntity.display_url);
            }
          });
        }
        if (refTweet.type === "quoted") {
          let quotedUser = includes.users.find(u => u.id === referencedTweet.author_id);
          let quotedUsername = quotedUser ? quotedUser.username : "unknown";
          fullText +=  `[quoted tweet by @${quotedUsername}]${referencedFullText}[/quoted tweet]`;
        } else if (refTweet.type === "retweeted") {
          let retweetedUser = includes.users.find(u => u.id === referencedTweet.author_id);
          let retweetedUsername = retweetedUser ? retweetedUser.username : "unknown";
          fullText = `RT @${retweetedUsername} ${referencedFullText}`;
        }
      }
    });
  }
  return fullText;
}

// Function to send tweet data to the webhook and to Supabase
async function forwardTweet(tweet, includes) {
  const user = includes.users.find(user => user.id === tweet.author_id);
  const username = user ? user.username : "unknown";

  let fullTweetText = getFullTweetText(tweet, includes);
  // Ensure no line breaks
  fullTweetText = fullTweetText.replace(/\n/g, ' ');

  // Skip forwarding if text starts with "@"
  if (fullTweetText.trim().startsWith('@')) {
    console.log(`Tweet ${tweet.id} starts with '@'. Skipping forwarding.`);
    return;
  }

  const urls = tweet.entities?.urls || [];
  let tweetExpandedURL = "";
  if (urls.length) {
    const nonXUrls = urls.filter(u => {
      try {
        const hostname = new URL(u.expanded_url).hostname.toLowerCase();
        return !hostname.endsWith("x.com");
      } catch {
        return true;
      }
    });
    const candidates = nonXUrls.length ? nonXUrls : urls;
    const longest = candidates.reduce((max, current) =>
      current.expanded_url.length > max.expanded_url.length ? current : max,
      candidates[0]
    );
    tweetExpandedURL = longest.expanded_url;
  }

  const payload = {
    timestamp: tweet.created_at,
    username,
    tweetId: tweet.id,
    conversationId: tweet.conversation_id,
    tweetText: fullTweetText,
    tweetExpandedURL,
  };

  // Insert into Supabase (fire-and-forget)
  supabase
    .from('Posts')
    .insert([{
      post_id:         tweet.id,
      post_timestamp: tweet.created_at,
      added_timestamp: new Date().toISOString(),
      x_id:            username,
      conversation_id: tweet.conversation_id,
      text:            fullTweetText,
      expanded_url:    tweetExpandedURL
    }])
    .then(({ error }) => {
      if (error) console.error(`Supabase insert error for tweet ${tweet.id}:`, error.message);
      else console.log(`Tweet ${tweet.id} logged to Supabase.`);
    })
    .catch(err => {
      console.error(`Error inserting tweet ${tweet.id} into Supabase:`, err.message);
    });

  // Send to Google Apps Script webhook (fire-and-forget)
  axios.post(WEBHOOK_URL, payload)
    .then(() => {
      console.log(`Tweet ${tweet.id} forwarded to webhook.`);
    })
    .catch(err => {
      console.error(`Error forwarding tweet ${tweet.id} to webhook:`, err.response?.data || err.message);
    });
}

// Called when a buffered thread has “quieted down” for WAIT_FOR_THREAD_MS
async function flushThread(conversationId) {
  const buffer = threadBuffers.get(conversationId);
  if (!buffer) return;
  clearTimeout(buffer.timeout);

  // Sort tweets by numeric ID ascending
  buffer.tweets.sort((a, b) => (BigInt(a.tweet.id) < BigInt(b.tweet.id) ? -1 : 1));

  // Merge their texts
  const mergedText = buffer.tweets
    .map(({ tweet, includes }) => getFullTweetText(tweet, includes).replace(/\n/g, ' '))
    .join(' ');

  // Use the root conversationId as tweetId
  const first = buffer.tweets[0];
  const user = first.includes.users.find(u => u.id === first.tweet.author_id);
  const username = user ? user.username : 'unknown';

  const payload = { timestamp: first.tweet.created_at, username, tweetId: conversationId, conversationId, tweetText: mergedText, tweetExpandedURL: '' };

  supabase
    .from('Posts')
    .insert([{
      post_id:         conversationId,
      post_timestamp:       first.tweet.created_at,
      added_timestamp: new Date().toISOString(),
      x_id:            username,
      conversation_id: conversationId,
      text:            mergedText,
      expanded_url:    '',
      is_possible_thread:       true,
    }])
    .then(({ error }) => {
      if (error) console.error(`Supabase insert error for thread ${conversationId}:`, error.message);
      else console.log(`Thread ${conversationId} logged to Supabase.`);
    })
    .catch(err => console.error(`Error inserting thread ${conversationId} into Supabase:`, err.message));
  
  axios.post(WEBHOOK_URL, payload)
    .then(() => console.log(`Thread ${conversationId} forwarded to webhook.`))
    .catch(err => console.error(`Error forwarding thread ${conversationId}:`, err.message));

  threadBuffers.delete(conversationId);
}

// New handler that decides whether to buffer or forward immediately
function handleTweet(tweet, includes) {
  const conversationId = tweet.conversation_id;
  const isRoot = conversationId === tweet.id;
  const text = tweet.note_tweet?.text || tweet.text;
  const threadIndicator = /(?:1\/(?:\d+|x)|🧵|👇|\bthread\b)/i.test(text);

  // If already buffering this conversation, keep buffering
  if (threadBuffers.has(conversationId)) {
    const buf = threadBuffers.get(conversationId);
    buf.tweets.push({ tweet, includes });
    clearTimeout(buf.timeout);
    buf.timeout = setTimeout(() => flushThread(conversationId), WAIT_FOR_THREAD_MS);
  }
  // Otherwise, if this is a root tweet indicating a thread, start buffering
  else if (isRoot && threadIndicator) {
    threadBuffers.set(conversationId, { tweets: [{ tweet, includes }], timeout: null });
    const buf = threadBuffers.get(conversationId);
    buf.timeout = setTimeout(() => flushThread(conversationId), WAIT_FOR_THREAD_MS);
  }
  // Otherwise, normal tweet → immediate forward
  else {
    forwardTweet(tweet, includes);
  }
}

// Function to initiate the stream connection with a recurring inactivity check
async function startStream() {
  if (streamInstance) {
    console.log('Stream is already active.');
    return;
  }

  // Set up a recurring check for inactivity every minute
  const inactivityInterval = setInterval(() => {
    // If 60 minutes have passed without receiving any tweets, force a full restart.
    if (Date.now() - lastTweetTime >= INACTIVITY_TIMEOUT) {
      console.log(`No data received for ${INACTIVITY_TIMEOUT / 60000} minutes. Forcing full container restart...`);
      clearInterval(inactivityInterval);
      forceFullRestart();
    }
  }, 60000);

  try {
    streamInstance = await twitterClient.v2.searchStream({ 'tweet.fields': 'created_at,conversation_id,note_tweet,referenced_tweets,entities', 'user.fields': 'username', expansions: 'author_id,referenced_tweets.id' });

    console.log('Connected to Twitter stream.');
    lastTweetTime = Date.now();

    for await (const { data, includes } of streamInstance) {
      lastTweetTime = Date.now();
      const usernameForLog = (includes && includes.users && includes.users[0]) ? includes.users[0].username : "unknown";
      console.log(`New tweet detected: ${data.id} from @${usernameForLog}`);
      handleTweet(data, includes);
    }
  } catch (error) {
    if (error && error.code === 429) {
      console.error("Received 429 error.");
        if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response headers:", JSON.stringify(error.response.headers, null, 2));
        console.error("Response data:", JSON.stringify(error.response.data, null, 2));
      } else {
        console.error("No response object. Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      }
      clearInterval(inactivityInterval);
      forceFullRestart();
    } else if (error && error.name === 'AbortError') {
      console.log('Stream aborted.');
    } else {
      console.error('Stream error:', error);
    }
  } finally {
    clearInterval(inactivityInterval);
    if (streamInstance && typeof streamInstance.destroy === 'function') {
      try {
        streamInstance.destroy();
      } catch (err) {
        console.error("Error destroying stream:", err);
      }
    }
    streamInstance = null;
  }
}

// Function to manage reconnections; runs until a shutdown is requested.
async function runStream() {
  let reconnectDelay = 30000;
  while (!isShuttingDown) {
    try {
      await startStream();
      reconnectDelay = 30000;
    } catch (error) {
      if (error && error.code === 429) {
        console.error("Received 429 error in runStream. Forcing full container restart now.");
        forceFullRestart();
      }
      console.error(`Stream disconnected. Reconnecting in ${reconnectDelay / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, reconnectDelay));
    }
  }
}

// Graceful shutdown: close the stream and exit.
function shutdown() {
  isShuttingDown = true;
  console.log('Shutdown initiated. Closing Twitter stream...');
  if (streamInstance && typeof streamInstance.destroy === 'function') {
    streamInstance.destroy();
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

runStream();
