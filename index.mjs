// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
// Cheerio භාවිතා කරන්නේ Ada Derana HTML පිටුවෙන් දත්ත ලබා ගැනීමටයි
import { load } from 'cheerio'; 
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ ඔබේ සත්‍ය දත්ත මගින් ප්‍රතිස්ථාපනය කරන්න.
    TELEGRAM_TOKEN: '8382727460:AAElnR4jEI91tavhJL6uCWiopUKsuZXhlcw',       
    
    // ප්‍රධාන Channel IDs (Forex News ඉවත් කළත්, Telegram Membership/Owner Check සඳහා අවශ්‍යයි)
    CHAT_ID_SINHALA: '-1003111341307',             // 🇱🇰 සිංහල Channel ID
    
    BOT_OWNER_ID: 1901997764, // Bot Owner ID
    
    // 🚨 NEW CONFIG: ඔබගේ Worker URL එක මෙහි ඇතුලත් කරන්න!
    WORKER_BASE_URL: 'https://fbpostbot.deshanchamod174.workers.dev', // 🚨 මෙය වෙනස් කරන්න
};

// --- NEW CONSTANTS FOR MEMBERSHIP CHECK AND BUTTON ---
const CHANNEL_USERNAME = 'C_F_News';
const CHANNEL_LINK_TEXT = 'C F NEWS ₿';
const CHANNEL_LINK_URL = `https://t.me/${CHANNEL_USERNAME}`;

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = {  
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const ADADERANA_NEWS_URL = 'https://sinhala.adaderana.lk/sinhala-hot-news.php'; // Ada Derana URL

// --- KV KEYS ---
// Forex keys ඉවත් කර ඇත. Ada Derana සහ Error Keys පමණක් ඉතිරි වේ.
const LAST_ERROR_KEY = 'last_critical_error'; 
const LAST_ERROR_TIMESTAMP = 'last_error_time'; 
const USER_LANG_PREFIX = 'user_lang_'; 
const LAST_ADADERANA_TITLE_KEY = 'last_adaderana_title'; // Ada Derana Title Tracker

// --- START MESSAGE CONSTANTS (Sarala Karana Ladi) ---
const RAW_START_CAPTION_SI = `👋 <b>ආයුබෝවන්!</b>\n\n` +
                             `💁‍♂️ මේ BOT මගින් <b>Ada Derana</b> හි නවතම පුවත් Facebook වෙත ස්වයංක්‍රීයව පළ කෙරේ.\n\n` +
                             `🎯 මේ BOT පැය 24ම Active එකේ තියෙනවා.🔔.. ✍️\n\n` +
                             `◇───────────────◇\n\n` +
                             `🚀 Developer : @chamoddeshan\n` +
                             `🔥 Mr Chamo Corporation ©\n\n` +
                             `◇───────────────◇`;


// =================================================================
// --- UTILITY FUNCTIONS (KV, Telegram, Facebook) ---
// =================================================================

/**
 * Posts an image and caption to the Facebook Page using the Graph API.
 */
async function postNewsWithImageToFacebook(caption, imageUrl, env) {
    // FACEBOOK_PAGE_ID සහ FACEBOOK_ACCESS_TOKEN env secrets වලින් ලබා ගනී
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/photos`;
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            caption: caption,
            url: imageUrl, // ඡායාරූපයේ URL එක
            access_token: env.FACEBOOK_ACCESS_TOKEN,
        }).toString(),
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(`Facebook API Error (Image Post): ${JSON.stringify(result.error)}`);
    }
    console.log(`Facebook Post Successful: ${result.id}`);
}

/**
 * Sends a message to Telegram, using the hardcoded TELEGRAM_TOKEN.
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
        console.error("TELEGRAM_TOKEN is missing or placeholder.");
        return false;
    }
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    
    let currentImgUrl = imgUrl; 
    let apiMethod = currentImgUrl ? 'sendPhoto' : 'sendMessage';
    let maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let payload = { chat_id: chatId, parse_mode: 'HTML' };

        if (apiMethod === 'sendPhoto' && currentImgUrl) {
            payload.photo = currentImgUrl;
            payload.caption = message;
        } else {
            payload.text = message;
            apiMethod = 'sendMessage';  
        }
        
        if (replyMarkup) {
            payload.reply_markup = JSON.stringify(replyMarkup);
        }

        if (replyToId) {
            payload.reply_to_message_id = replyToId;
            payload.allow_sending_without_reply = true;
        }

        const apiURL = `${TELEGRAM_API_URL}/${apiMethod}`;
        
        try {
            const response = await fetch(apiURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; 
            }

            if (!response.ok) {
                const errorText = await response.text();
                if (apiMethod === 'sendPhoto') {
                    currentImgUrl = null; 
                    apiMethod = 'sendMessage';
                    attempt = -1; // Restart loop as sendMessage
                    console.error(`SendPhoto failed, retrying as sendMessage: ${errorText}`);
                    continue; 
                }
                console.error(`Telegram API Error (${apiMethod}): ${response.status} - ${errorText}`);
                break; 
            }
            return true; // Success
        } catch (error) {
            console.error("Error sending message to Telegram:", error);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return false;  
}

/**
 * Edits the text (caption) and keyboard of an existing message.
 */
async function editTelegramMessage(chatId, messageId, newText, replyMarkup = null) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
    const url = `${TELEGRAM_API_URL}/editMessageText`;

    const payload = { 
        chat_id: chatId, 
        message_id: messageId, 
        text: newText, 
        parse_mode: 'HTML' 
    };

    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Telegram Edit Message Error: ${response.status} - ${errorText}`);
            return false;
        }
        return true;
    } catch (error) {
        console.error("Error editing message:", error);
        return false;
    }
}

/**
 * Reads data from the KV Namespace, assuming it is bound as env.NEWS_STATE.
 */
async function readKV(env, key) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV.");
            return null;
        }
        const value = await env.NEWS_STATE.get(key);  
        if (value === null || value === undefined) {
            return null;
        }
        return value;
    } catch (e) {
        console.error(`KV Read Error (${key}):`, e);
        return null;
    }
}

/**
 * Writes data to the KV Namespace, assuming it is bound as env.NEWS_STATE.
 */
async function writeKV(env, key, value) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        await env.NEWS_STATE.put(key, String(value));  
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}


// =================================================================
// --- CORE ADADERANA NEWS LOGIC (Using Cheerio) ---
// =================================================================

async function getLatestAdaDeranaNews() {
    const AD_URL = ADADERANA_NEWS_URL;
    
    // Headers භාවිතයෙන් පිටුව Fetch කිරීම
    const resp = await fetch(AD_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[AD SCRAPING ERROR] HTTP error! status: ${resp.status} on news page.`);

    const html = await resp.text();
    const $ = load(html);
    
    // ඔබගේ inspect screenshot එකට අනුව පළමු news-story එක ලබා ගනී
    const newsStory = $('.news-story').first(); 
    
    if (newsStory.length === 0) return null;

    // 1. Title සහ Link ලබා ගැනීම
    const titleLinkTag = newsStory.find('h2 a');
    const title = titleLinkTag.text().trim().replace(/\s{2,}/g, ' ').replace(/&nbsp;/g, ' '); 
    let link = titleLinkTag.attr('href');
    
    // 2. Image URL ලබා ගැනීම
    const imgTag = newsStory.find('.thumb-image img');
    let imgUrl = imgTag.attr('src');
    
    // 3. සාපේක්ෂ Link (Relative link) එකක් නම්, Base URL එක එකතු කිරීම
    if (link && !link.startsWith('http')) {
        link = "https://sinhala.adaderana.lk/" + link;
    }
    
    // 4. අවශ්‍ය දත්ත නොමැති නම් Post නොකරන්න
    if (!title || !link || !imgUrl) return null;

    return { title, link, imgUrl };
}

// =================================================================
// --- ADADERANA SCHEDULED TASK (Facebook Posting) ---
// =================================================================

async function fetchAdaDeranaNews(env) {
    const CHAT_ID_OWNER = HARDCODED_CONFIG.BOT_OWNER_ID; 
    
    try {
        const news = await getLatestAdaDeranaNews();
        if (!news) {
            console.info(`Ada Derana: No news found or scraping failed.`);
            return;
        }

        const lastTitle = await readKV(env, LAST_ADADERANA_TITLE_KEY);
        const currentTitle = news.title;

        if (currentTitle === lastTitle) {
            console.info(`Ada Derana: No new title. Last: ${currentTitle}`);
            return; 
        }

        // --- 1. Construct Message and Post to Facebook ---
        const caption = `🚨 බ්‍රේකින් නිවුස් 🚨\n\n` +
                        `${news.title}\n\n` +
                        `වැඩිදුර විස්තර: ${news.link}`;
        
        await postNewsWithImageToFacebook(caption, news.imgUrl, env);
        
        // --- 2. Store Last Posted Title ---
        await writeKV(env, LAST_ADADERANA_TITLE_KEY, currentTitle);
        
        // --- 3. Success Notification to Owner (optional - for testing) ---
        // await sendRawTelegramMessage(CHAT_ID_OWNER, `✅ Facebook Posted: ${currentTitle}`, null, null); 
        
    } catch (error) {
        const errorTime = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        const errorMessage = `[${errorTime}] ADADERANA TASK FAILED: ${error.stack}`;
        console.error("An error occurred during ADADERANA task:", errorMessage);
        
        // Error KV එකට ලියන්න
        await writeKV(env, LAST_ERROR_KEY, errorMessage);
        await writeKV(env, LAST_ERROR_TIMESTAMP, errorTime);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (User Commands) ---
// =================================================================

/**
 * Generates the Admin status message.
 */
async function generateBotStatusMessage(env) {
    const lastError = await readKV(env, LAST_ERROR_KEY);
    const errorTime = await readKV(env, LAST_ERROR_TIMESTAMP);
    const lastCheckedAdaDerana = await readKV(env, LAST_ADADERANA_TITLE_KEY); 

    let statusMessage = `🤖 <b>BOT SYSTEM STATUS (ADMIN VIEW)</b> 🤖\n\n`;
    // AI Key check එක මෙතනින් ඉවත් කර ඇත. 
    statusMessage += `✅ <b>KV Binding:</b> ${env.NEWS_STATE ? 'OK (Active)' : '❌ FAIL (Missing)'}\n`;
    statusMessage += `🇱🇰 <b>Last AdaDerana Title:</b> ${lastCheckedAdaDerana ? `<code>${lastCheckedAdaDerana}</code>` : 'None'}\n\n`; 

    if (lastError) {
        statusMessage += `🚨 <b>Last CRITICAL Error</b> (at ${errorTime}):\n` +
                         `<code>${lastError.substring(0, 500)}...</code>\n\n`; 
    } else {
        statusMessage += `✅ <b>Last Error Check:</b> No critical errors recorded.\n\n`;
    }

    statusMessage += `🔥 <b>Tip:</b> Use 'KV Reset' if the bot is stuck.`;
    return statusMessage;
}


/**
 * Executes the final /start message.
 */
async function sendFinalStartMessage(chatId, userId, isOwner, messageId, env) {
    const isEditing = messageId != null;
    const finalCaption = RAW_START_CAPTION_SI; // භාෂා තේරීම ඉවත් කර ඇත.

    let keyboard = [];

    if (isOwner) {
        const TRIGGER_URL = HARDCODED_CONFIG.WORKER_BASE_URL + '/trigger';
        
        keyboard.push(
            [{ text: '⚡️ Manual News Trigger', url: TRIGGER_URL }] 
        );
        
         keyboard.push(
            [
                { text: '🤖 BOT STATUS', callback_data: '/botstatus_admin' }, 
                { text: '♻️ KV RESET', callback_data: '/resetkv_admin' }     
            ]
         );
         keyboard.push(
            [{ text: 'Owner ID (Dev Info)', url: `https://t.me/chamoddeshan`}]
         );
    }
    
    const replyMarkup = { inline_keyboard: keyboard };
    
    if (isEditing) {
        await editTelegramMessage(chatId, messageId, finalCaption, replyMarkup);
    } else {
        await sendRawTelegramMessage(chatId, finalCaption, null, replyMarkup, null);
    }
}


async function handleTelegramUpdate(update, env) {
    const BOT_OWNER_ID = HARDCODED_CONFIG.BOT_OWNER_ID; 

    if (!update.message && !update.callback_query) {
        return; 
    }
    
    let userId;
    let chatId;
    let messageId;
    let text = '';
    
    if (update.message) {
        userId = update.message.from.id;
        chatId = update.message.chat.id; 
        messageId = update.message.message_id; 
        text = update.message.text ? update.message.text.trim() : '';
    } else if (update.callback_query) {
        userId = update.callback_query.from.id;
        chatId = update.callback_query.message.chat.id;
        messageId = update.callback_query.message.message_id;
        text = update.callback_query.data;
        
        // Answer callback query to remove "loading" state
        await fetch(`https://api.telegram.org/bot${HARDCODED_CONFIG.TELEGRAM_TOKEN}/answerCallbackQuery?callback_query_id=${update.callback_query.id}`);
    }

    const command = text.split(' ')[0].toLowerCase();
    
    const isOwner = (userId === BOT_OWNER_ID);
    
    // --- 1. COMMAND EXECUTION ---
    switch (command) {
        case '/start':
            // භාෂා තේරීම ඉවත් කර සෘජුවම /start message එක යවයි
            await sendFinalStartMessage(chatId, userId, isOwner, null, env);
            break;

        case '/botstatus_admin': 
            if (!isOwner) return;
            const statusMessage = await generateBotStatusMessage(env);
            const backKeyboardStatus = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }] // /start වෙත යළි යොමු කරයි
            ]};
            
            await editTelegramMessage(chatId, messageId, statusMessage, backKeyboardStatus);
            break;
            
        case '/resetkv_admin':
            if (!isOwner) return;
            if (env.NEWS_STATE) {
                await env.NEWS_STATE.delete(LAST_ADADERANA_TITLE_KEY);
                await env.NEWS_STATE.delete(LAST_ERROR_KEY);
                await env.NEWS_STATE.delete(LAST_ERROR_TIMESTAMP);
            }
            
            const resetMessage = `✅ <b>KV Storage Reset Successful!</b>\nLast checked Ada Derana Title and error logs have been cleared.\n\n` + 
                `The News fetch will restart on the next scheduled run or /trigger.`;
                
            const backKeyboardReset = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};
            
            await editTelegramMessage(chatId, messageId, resetMessage, backKeyboardReset);
            break;

        default:
            if (update.message) {
                 const defaultReplyText = `Please use the /start command to see available options.`;
                 await sendRawTelegramMessage(chatId, defaultReplyText, null, null, messageId); 
            }
            break;
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// =================================================================

async function handleScheduledTasks(env) {
    // Ada Derana News Task (Facebook Posting) පමණක් ක්‍රියාත්මක කරයි
    await fetchAdaDeranaNews(env); 
}

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            (async () => {
                try {
                    await handleScheduledTasks(env);
                } catch (error) {
                    const errorTime = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
                    const errorMessage = `[${errorTime}] WORKER CRON FAILED: ${error.stack}`;
                    await writeKV(env, LAST_ERROR_KEY, errorMessage);
                    await writeKV(env, LAST_ERROR_TIMESTAMP, errorTime);
                }
            })()
        );
    },

    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            if (url.pathname === '/trigger') {
                // Manually run the scheduled task
                await handleScheduledTasks(env);
                return new Response("Ada Derana Facebook Bot manually triggered. Check Worker Logs.", { status: 200 });
            }
            
            if (url.pathname === '/status') {
                const lastAdaDerana = await readKV(env, LAST_ADADERANA_TITLE_KEY);
                const statusMessage = 
                    `Ada Derana News Bot Worker is active.\n` + 
                    `KV Binding Check: ${env.NEWS_STATE ? 'OK (Bound)' : 'FAIL (Missing Binding)'}\n` +
                    `Last AdaDerana Title: ${lastAdaDerana || 'N/A'}`;
                return new Response(statusMessage, { status: 200 });
            }

            if (request.method === 'POST') {
                const update = await request.json();
                await handleTelegramUpdate(update, env); 
                return new Response('OK', { status: 200 });
            }

            return new Response('Ada Derana Facebook Bot is ready.', { status: 200 });
            
        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}.`, { status: 500 });
        }
    }
};
