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
let isShuttingDown = false;

// Define inactivity timeout (set to 90 minutes)
const INACTIVITY_TIMEOUT = 90 * 60 * 1000; // in ms
let lastTweetTime      = Date.now();

// Force a container restart
function forceFullRestart() {
  console.log("Forcing full container restart...");
  process.exit(1);
}

// Assemble full tweet text (handles Note Tweets, t.co replacements, quoted/retweeted)
function getFullTweetText(tweet, includes) {
  let fullText = tweet.note_tweet?.text ?? tweet.text;

  // Replace t.co URLs
  tweet.entities?.urls?.forEach(urlEntity => {
    if (!urlEntity.display_url.includes("…")) {
      fullText = fullText.replace(urlEntity.url, urlEntity.display_url);
    }
  });

  // Handle referenced tweets
  if (tweet.referenced_tweets && includes?.tweets) {
    tweet.referenced_tweets.forEach(ref => {
      const refTweet = includes.tweets.find(t => t.id === ref.id);
      if (!refTweet) return;

      let refText = refTweet.note_tweet?.text ?? refTweet.text;
      refTweet.entities?.urls?.forEach(u => {
        if (!u.display_url.includes("…")) {
          refText = refText.replace(u.url, u.display_url);
        }
      });

      const author = includes.users.find(u => u.id === refTweet.author_id)?.username ?? "unknown";
      if (ref.type === "quoted") {
        fullText += ` [quoted tweet by @${author}]${refText}[/quoted tweet]`;
      } else if (ref.type === "retweeted") {
        fullText = `RT @${author} ${refText}`;
      }
    });
  }

  return fullText;
}

// Send to webhook + Supabase
async function forwardTweet(tweet, includes) {
  const user     = includes.users.find(u => u.id === tweet.author_id);
  const username = user?.username ?? "unknown";
  let   text     = getFullTweetText(tweet, includes).replace(/\n/g, ' ');

  if (text.startsWith('@')) {
    console.log(`Skipping @-reply tweet ${tweet.id}`);
    return;
  }
  
  const expanded = tweet.entities?.urls?.reduce(
    (max, cur) => cur.expanded_url.length > max.expanded_url.length ? cur : max,
    tweet.entities?.urls?.[0] ?? { expanded_url: "" }
  ).expanded_url;

  const payload = {
    timestamp:      tweet.created_at,
    username,
    tweetId:        tweet.id,
    conversationId: tweet.conversation_id,
    in_reply_to_user_id: tweet.in_reply_to_user_id,
    tweetText:      text,
    tweetExpandedURL: expanded,
  };

  try {
    // 1) Webhook
    await axios.post(WEBHOOK_URL, payload);
    console.log(`Tweet ${tweet.id} forwarded to webhook.`);

    // 2) Supabase
    const { error } = await supabase
      .from('Posts')
      .insert([{
        post_id:         tweet.id,
        timestamp:       tweet.created_at,
        x_id:            username,
        conversation_id: tweet.conversation_id,
        text,
        expanded_url:    expanded,
      }]);

    if (error) {
      console.error(`Supabase insert error for tweet ${tweet.id}:`, error.message);
    } else {
      console.log(`Tweet ${tweet.id} logged to Supabase.`);
    }
  } catch (err) {
    console.error(`Error handling tweet ${tweet.id}:`, err.response?.data || err.message);
  }
}

// Start the filtered stream and check for inactivity
async function startStream() {
  if (streamInstance) {
    console.log('Stream is already active.');
    return;
  }

  // Inactivity watchdog
  const inactivityInterval = setInterval(() => {
    if (Date.now() - lastTweetTime >= INACTIVITY_TIMEOUT) {
      console.log(`No data for ${INACTIVITY_TIMEOUT/60000} minutes → restarting.`);
      clearInterval(inactivityInterval);
      forceFullRestart();
    }
  }, 60 * 1000);

  try {
    streamInstance = await twitterClient.v2.searchStream({
      'tweet.fields': 'created_at,conversation_id,note_tweet,referenced_tweets,entities,in_reply_to_user_id',
      'user.fields':  'username',
      expansions:     'author_id,referenced_tweets.id'
    });

    console.log('Connected to Twitter stream.');
    lastTweetTime = Date.now();

    for await (const { data, includes } of streamInstance) {
      lastTweetTime = Date.now();
      const logUser = includes?.users?.[0]?.username ?? "unknown";
      console.log(`New tweet: ${data.id} from @${logUser}`);

      // ↓ FIRE & FORGET → concurrent forwarding
      forwardTweet(data, includes);
    }
  } catch (error) {
    if (error.code === 429) {
      console.error("Rate limit (429) → restarting.");
      clearInterval(inactivityInterval);
      forceFullRestart();
    } else if (error.name === 'AbortError') {
      console.log('Stream aborted.');
    } else {
      console.error('Stream error:', error);
    }
  } finally {
    clearInterval(inactivityInterval);
    streamInstance?.destroy?.();
    streamInstance = null;
  }
}

// Persistent loop with back‑off
async function runStream() {
  let reconnectDelay = 30_000;
  while (!isShuttingDown) {
    try {
      await startStream();
      reconnectDelay = 30_000;
    } catch (err) {
      if (err.code === 429) {
        forceFullRestart();
      }
      console.error(`Disconnected. Reconnect in ${reconnectDelay/1000}s...`);
      await new Promise(r => setTimeout(r, reconnectDelay));
    }
  }
}

// Graceful shutdown
function shutdown() {
  isShuttingDown = true;
  console.log('Shutdown requested. Closing stream...');
  streamInstance?.destroy?.();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

runStream();
