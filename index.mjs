// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ ඔබේ සත්‍ය දත්ත මගින් ප්‍රතිස්ථාපනය කරන්න.
    TELEGRAM_TOKEN: '8382727460:AAElnR4jEI91tavhJL6uCWiopUKsuZXhlcw',       
    CHAT_ID_SINHALA: '-1003111341307',             // ප්‍රධාන Channel ID (Ada Derana Posts යැවීමට නොවේ, නමුත් අනෙකුත් functions සඳහා තබා ඇත)
    BOT_OWNER_ID: 1901997764, // Bot Owner ID (Verification Messages සඳහා)
    WORKER_BASE_URL: 'https://fbpostbot.deshanchamod174.workers.dev/', // 🚨 මෙය වෙනස් කරන්න
};

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = {  
    'User-Agent': 'Mozilla/50 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const ADADERANA_NEWS_URL = 'https://sinhala.adaderana.lk/sinhala-hot-news.php'; 
const FALLBACK_DESCRIPTION = "⚠️ සම්පූර්ණ ලිපිය ලබාගැනීමට නොහැකි විය. කරුණාකර වෙබ් අඩවිය පරීක්ෂා කරන්න.";

// --- KV KEYS ---
// Ada Derana සඳහා අවශ්‍ය KEYS පමණක් තබා ඇත
const LAST_ERROR_KEY = 'last_critical_error'; 
const LAST_ERROR_TIMESTAMP = 'last_error_time'; 
const LAST_ADADERANA_TITLE_KEY = 'last_adaderana_title'; 
const USER_LANG_PREFIX = 'user_lang_'; // Telegram Command Handler සඳහා තබා ඇත.

// --- START MESSAGE CONSTANTS ---
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
 * Posts an image and caption to the Facebook Page using the Graph API. (FIXED: Added URL check and detailed error logging)
 */
async function postNewsWithImageToFacebook(caption, imageUrl, env) {
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/photos`;
    
    if (!imageUrl || !imageUrl.startsWith('http')) {
        throw new Error(`Invalid or missing image URL for Facebook Post: ${imageUrl}`);
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            caption: caption,
            url: imageUrl, 
            access_token: env.FACEBOOK_ACCESS_TOKEN,
        }).toString(),
    });

    const result = await response.json();
    if (!response.ok) {
        // Facebook API වෙතින් ලැබෙන දෝෂය සහ අසාර්ථක වූ URL එක Log කරයි
        throw new Error(`Facebook API Error (Image Post) - Failed URL: ${imageUrl} - Error: ${JSON.stringify(result.error)}`);
    }
    console.log(`Facebook Post Successful: ${result.id}`);
}


/**
 * Sends a message to Telegram. (Supports text and photo with fallback)
 */
async function sendRawTelegramMessage(chatId, message, imgUrl = null, replyMarkup = null, replyToId = null) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    if (!TELEGRAM_TOKEN) {
        console.error("TELEGRAM_TOKEN is missing.");
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
            payload.caption = message; // Use message as caption
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
                // If sendPhoto fails, retry as sendMessage (without image)
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
            return true; 
        } catch (error) {
            console.error("Error sending message to Telegram:", error);
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return false;  
}

/**
 * Reads data from the KV Namespace.
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
 * Writes data to the KV Namespace.
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


// =================================================================
// --- CORE ADADERANA NEWS LOGIC (Using Cheerio) ---
// =================================================================

async function getLatestAdaDeranaNews() {
    const AD_URL = ADADERANA_NEWS_URL;
    
    // --- 1. Summary Page Fetch: Title, Link, Thumbnail ---
    const resp = await fetch(AD_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[AD SCRAPING ERROR] HTTP error! status: ${resp.status} on news page.`);

    const html = await resp.text();
    const $ = load(html);
    
    // පුවතේ පළමුම item එක තෝරා ගනී
    const newsStory = $('.news-story').first(); 
    if (newsStory.length === 0) return null;

    const titleLinkTag = newsStory.find('h2 a');
    const title = titleLinkTag.text().trim().replace(/\s{2,}/g, ' ').replace(/&nbsp;/g, ' '); 
    let link = titleLinkTag.attr('href');
    
    const imgTagThumb = newsStory.find('.thumb-image img');
    let imgUrl = imgTagThumb.attr('src'); 
    
    if (link && !link.startsWith('http')) {
        link = "https://sinhala.adaderana.lk/" + link;
    }

    if (!title || !link) return null;

    // --- 2. Detail Page Fetch: Description and Higher Quality Image ---
    let description = "";
    let betterImageUrl = imgUrl; 

    try {
        const detailResp = await fetch(link, { headers: HEADERS });
        if (!detailResp.ok) throw new Error(`[AD DETAIL ERROR] HTTP error! status: ${detailResp.status} on detail page.`);

        const detailHtml = await detailResp.text();
        const $detail = load(detailHtml);
        
        // Description Scraping: news-content div එකේ p tag වල ඇති සියලුම text එකතු කරයි.
        let paragraphs = [];
        $detail('div.news-content p').each((i, el) => { 
            const pText = $detail(el).text().trim();
            // හිස් හෝ ඉතා කෙටි (20ට අඩු) paragraph හෝ අනවශ්‍ය headers ඉවත් කරයි
            if (pText.length > 20 && !pText.startsWith('24/7')) { 
                 paragraphs.push(pText);
            }
        });
        
        description = paragraphs.join('\n\n').trim();
        if (description.length < 50) { 
             description = FALLBACK_DESCRIPTION;
        }

        // High Quality Image Scraping: news-banner div එකේ ඇති image එක තෝරා ගනී.
        const mainImage = $detail('div.news-banner img').first().attr('src'); 
        if (mainImage) {
            let cleanedImageUrl = mainImage.trim();
            if (cleanedImageUrl.startsWith('http')) {
                 betterImageUrl = cleanedImageUrl;
            } else if (cleanedImageUrl.startsWith('/')) {
                 betterImageUrl = `https://sinhala.adaderana.lk${cleanedImageUrl}`;
            }
        }

    } catch (e) {
        console.error(`Error fetching/scraping detail page ${link}: ${e.message}`);
        description = FALLBACK_DESCRIPTION;
    }
    
    return { title, link, imgUrl: betterImageUrl, description };
}

// =================================================================
// --- ADADERANA SCHEDULED TASK (Facebook Posting) ---
// =================================================================

async function fetchAdaDeranaNews(env) {
    const BOT_OWNER_ID = HARDCODED_CONFIG.BOT_OWNER_ID; 

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

        // --- 1. Description සකස් කිරීම ---
        let cleanDescription = news.description;
        if (cleanDescription.startsWith(news.title)) {
            cleanDescription = cleanDescription.substring(news.title.length).trim();
        }
        
        // --- 2. Facebook Post Caption සකස් කිරීම ---
        // Telegram verification සඳහා link එකද ඇතුලත් කරමු.
        const facebookCaption = `🚨 බ්‍රේකින් නිවුස් 🚨\n\n` +
                                `${news.title}\n\n` +
                                `${cleanDescription}\n\n` + 
                                `Source: ${news.link}\n` + 
                                `#SriLanka #AdaDerana #BreakingNews`; 

        // --- 3. TELEGRAM NOTIFICATION TO OWNER (Full News Verification) ---
        await sendRawTelegramMessage(BOT_OWNER_ID, facebookCaption, news.imgUrl, null);
        console.log(`Sent full news verification to Telegram Owner.`);
        
        // --- 4. Facebook වෙත Post කිරීමට යැවීම ---
        // Facebook Post එකට link එක අනිවාර්යයෙන් අවශ්‍ය නම් පමණක් තබන්න.
        // බොහෝ විට, Facebook Link එක Caption එකේ තිබීමෙන් reach එක අඩු වේ.
        // Telegram පණිවිඩයේ තිබූ Source Link එක ඉවත් කර final caption එක සකස් කරයි.
        const finalFacebookCaption = `🚨 බ්‍රේකින් නිවුස් 🚨\n\n` +
                                     `${news.title}\n\n` +
                                     `${cleanDescription}\n\n` + 
                                     `#SriLanka #AdaDerana #BreakingNews`; 
        
        await postNewsWithImageToFacebook(finalFacebookCaption, news.imgUrl, env);
        
        // --- 5. Store Last Posted Title ---
        await writeKV(env, LAST_ADADERANA_TITLE_KEY, currentTitle);
        
    } catch (error) {
        const errorTime = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        const errorMessage = `[${errorTime}] ADADERANA TASK FAILED: ${error.stack}`;
        console.error("An error occurred during ADADERANA task:", errorMessage);
        
        await writeKV(env, LAST_ERROR_KEY, errorMessage);
        await writeKV(env, LAST_ERROR_TIMESTAMP, errorTime);
        
        // Error එකක් ආවොත් Owner ට දැනුම් දීම
         await sendRawTelegramMessage(HARDCODED_CONFIG.BOT_OWNER_ID, `❌ <b>CRITICAL ERROR!</b> Ada Derana Posting Failed.\n\nTime: ${errorTime}\n\nError: <code>${error.message}</code>`, null);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (Simplified for Ada Derana Bot) ---
// =================================================================

/**
 * Generates the Admin status message. (Simplified)
 */
async function generateBotStatusMessage(env) {
    const lastError = await readKV(env, LAST_ERROR_KEY);
    const errorTime = await readKV(env, LAST_ERROR_TIMESTAMP);
    const lastCheckedTitle = await readKV(env, LAST_ADADERANA_TITLE_KEY);

    let statusMessage = `🤖 <b>BOT SYSTEM STATUS (ADMIN VIEW)</b> 🤖\n\n`;
    statusMessage += `✅ <b>KV Binding:</b> ${env.NEWS_STATE ? 'OK (Active)' : '❌ FAIL (Missing)'}\n`;
    statusMessage += `📰 <b>Last Posted News:</b> ${lastCheckedTitle ? `<code>${lastCheckedTitle}</code>` : 'None'}\n\n`;

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
    const BOT_OWNER_ID = HARDCODED_CONFIG.BOT_OWNER_ID; 
    const isEditing = messageId != null;

    const finalCaption = RAW_START_CAPTION_SI;

    let keyboard = [];

    if (isOwner) {
        const TRIGGER_URL = HARDCODED_CONFIG.WORKER_BASE_URL + '/trigger';
        
        keyboard.push(
            [{ text: '⚡️ Manual Ada Derana Trigger', url: TRIGGER_URL }] 
        );
        
         keyboard.push(
            [
                { text: '🤖 BOT STATUS', callback_data: '/botstatus_admin' }, 
                { text: '♻️ KV RESET', callback_data: '/resetkv_admin' }     
            ]
         );
    }
    
    const replyMarkup = { inline_keyboard: keyboard };
    
    if (isEditing) {
         // If a message ID is provided (from a button click), edit it
        await editTelegramMessage(chatId, messageId, finalCaption, replyMarkup);
    } else {
        // Otherwise, send a new message
        await sendRawTelegramMessage(chatId, finalCaption, null, replyMarkup, null);
    }
}

/**
 * Handles incoming Telegram updates (messages and callback queries).
 */
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

    // --- COMMAND EXECUTION ---
    switch (command) {
        case '/start':
            await sendFinalStartMessage(chatId, userId, isOwner, null, env);
            break;

        case '/botstatus_admin': 
             if (!isOwner) return; // Admin check
            
            const statusMessage = await generateBotStatusMessage(env);
            const backKeyboardStatus = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};
            
            await editTelegramMessage(chatId, messageId, statusMessage, backKeyboardStatus);
            break;
            
        case '/resetkv_admin':
             if (!isOwner) return; // Admin check
             
            if (env.NEWS_STATE) {
                // Ada Derana specific keys පමණක් reset කරයි
                await env.NEWS_STATE.delete(LAST_ADADERANA_TITLE_KEY);
                await env.NEWS_STATE.delete(LAST_ERROR_KEY);
                await env.NEWS_STATE.delete(LAST_ERROR_TIMESTAMP);
            }
            
            const resetMessage = `✅ <b>KV මතකය සාර්ථකව යළි පිහිටුවන ලදී!</b>\nඅවසන් පුවත් සිරස්තලය සහ දෝෂ සටහන් ඉවත් කර ඇත.\n\n` +
                `පුවත් ලබා ගැනීම ඊළඟ Scheduled run හෝ /trigger හරහා යළි ආරම්භ වේ.`;
                
            const backKeyboardReset = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};
            
            await editTelegramMessage(chatId, messageId, resetMessage, backKeyboardReset);
            break;

        // /start callback_data එකෙන් back වීම සඳහා
        case '/back_admin': 
            await sendFinalStartMessage(chatId, userId, isOwner, messageId, env);
            break;

        default:
            if (update.message) {
                 const defaultReplyText = `පවතින විධානයන් බැලීමට /start යොදන්න.`;
                 await sendRawTelegramMessage(chatId, defaultReplyText, null, null, messageId); 
            }
            break;
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// =================================================================

async function handleScheduledTasks(env) {
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
                    await sendRawTelegramMessage(HARDCODED_CONFIG.BOT_OWNER_ID, `❌ <b>CRITICAL CRON ERROR!</b>\n\nTime: ${errorTime}\n\nError: <code>${error.message}</code>`, null);
                }
            })()
        );
    },

    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            if (url.pathname === '/trigger') {
                await handleScheduledTasks(env);
                return new Response("Ada Derana Facebook Bot manually triggered. Check Worker Logs and Telegram Owner Chat for status.", { status: 200 });
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
