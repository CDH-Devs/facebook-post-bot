// --- ES MODULE IMPORTS (Required for Cloudflare Workers) ---
import { load } from 'cheerio'; 
import moment from 'moment-timezone';

// =================================================================
// --- 🔴 HARDCODED CONFIGURATION (KEYS INSERTED DIRECTLY) 🔴 ---
// =================================================================

const HARDCODED_CONFIG = {
    // ⚠️ ඔබේ සත්‍ය දත්ත මගින් ප්‍රතිස්ථාපනය කරන්න.
    TELEGRAM_TOKEN: '8382727460:AAElnR4jEI91tavhJL6uCWiopUKsuZXhlcw',       
    CHAT_ID_SINHALA: '-1003111341307',             
    BOT_OWNER_ID: 1901997764, // Bot Owner ID (Verification Messages සඳහා)
    // 🛑 /trigger ඉවත් කර ඇත!
    WORKER_BASE_URL: 'https://fbpostbot.deshanchamod174.workers.dev', 
};

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const MAX_RETRIES = 5; 
const HEADERS = {  
    'User-Agent': 'Mozilla/50 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const ADADERANA_NEWS_URL = 'https://sinhala.adaderana.lk/sinhala-hot-news.php'; 
const FALLBACK_DESCRIPTION = "⚠️ සම්පූර්ණ ලිපිය ලබාගැනීමට නොහැකි විය. කරුණාකර වෙබ් අඩවිය පරීක්ෂා කරන්න.";

// --- KV KEYS ---
const LAST_ERROR_KEY = 'last_critical_error'; 
const LAST_ERROR_TIMESTAMP = 'last_error_time'; 
const LAST_ADADERANA_TITLE_KEY = 'last_adaderana_title'; 
const PENDING_ADADERANA_POST = 'pending_adaderana_post'; 
const USER_LANG_PREFIX = 'user_lang_'; // Telegram Command Handler සඳහා තබා ඇත.

// --- START MESSAGE CONSTANTS (Telegram handler සඳහා) ---
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
 * Reads data from the KV Namespace.
 */
async function readKV(env, key) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV.");
            return null;
        }
        // KV Read එකේදී JSON parse කිරීමට උත්සාහ කරයි (පෙර තිබූ)
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
 * Posts an image and caption to the Facebook Page using the Graph API.
 */
async function postNewsWithImageToFacebook(caption, imageUrl, env) {
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/photos`;
    
    let isTextOnly = (!imageUrl || !imageUrl.startsWith('http'));
    
    if (!env.FACEBOOK_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) {
        throw new Error("Missing FACEBOOK_ACCESS_TOKEN or FACEBOOK_PAGE_ID environment variables.");
    }
    
    const bodyParams = {
        caption: caption,
        access_token: env.FACEBOOK_ACCESS_TOKEN,
    };
    
    if (!isTextOnly) {
        bodyParams.url = imageUrl;
    } 

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(bodyParams).toString(),
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(`Facebook API Error (${isTextOnly ? 'Text' : 'Image'} Post) - Failed URL: ${imageUrl || 'N/A'} - Error: ${JSON.stringify(result.error)}`);
    }
    console.log(`Facebook Post Successful: ${result.id}`);
}


/**
 * Sends a message to Telegram.
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
                    attempt = -1; 
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
// --- CORE ADADERANA NEWS LOGIC (Scraping) ---
// =================================================================

/**
 * Scrapes the latest news summary data from the Ada Derana homepage.
 */
async function getLatestAdaDeranaNewsSummary() {
    const resp = await fetch(ADADERANA_NEWS_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[AD SCRAPING ERROR] HTTP error! status: ${resp.status} on news page.`);

    const html = await resp.text();
    const $ = load(html);
    
    const newsStory = $('.news-story').first(); 
    if (newsStory.length === 0) return null;

    const titleLinkTag = newsStory.find('h2 a');
    const title = titleLinkTag.text().trim().replace(/\s{2,}/g, ' ').replace(/&nbsp;/g, ' '); 
    let link = titleLinkTag.attr('href');
    
    const imgTagThumb = newsStory.find('.thumb-image img');
    let imgUrl = imgTagThumb.attr('src'); // Thumbnail URL (Fallback)
    
    if (link && !link.startsWith('http')) {
        link = "https://sinhala.adaderana.lk/" + link;
    }

    if (!title || !link) return null;
    
    return { title, link, imgUrl };
}

/**
 * Re-scrapes the detail page for the high-quality image and description.
 * (Used for both initial scrape and polling)
 */
async function reScrapeDetails(link) {
    let description = FALLBACK_DESCRIPTION;
    let betterImageUrl = null;
    
    try {
        const detailResp = await fetch(link, { headers: HEADERS });
        if (!detailResp.ok) throw new Error(`[AD DETAIL ERROR] HTTP error! status: ${detailResp.status} on detail page.`);

        const detailHtml = await detailResp.text();
        const $detail = load(detailHtml);
        
        // --- 1. Description ---
        let paragraphs = [];
        $detail('div.news-content p').each((i, el) => { 
            const pText = $detail(el).text().trim();
            if (pText.length > 20 && !pText.startsWith('24/7')) { 
                 paragraphs.push(pText);
            }
        });
        description = paragraphs.join('\n\n').trim();
        if (description.length < 50) { 
             description = FALLBACK_DESCRIPTION;
        }

        // --- 2. Image ---
        const mainImage = $detail('div.news-banner img').first().attr('src'); 
        if (mainImage) {
            let cleanedImageUrl = mainImage.trim();
            let potentialImageUrl = null;
            
            if (cleanedImageUrl.startsWith('http')) {
                 potentialImageUrl = cleanedImageUrl;
            } else if (cleanedImageUrl.startsWith('/')) {
                 potentialImageUrl = `https://sinhala.adaderana.lk${cleanedImageUrl}`;
            }

            // Image URL validation: Must be a full URL and end with a common image extension
            if (potentialImageUrl && potentialImageUrl.length > 50 && (potentialImageUrl.endsWith('.jpg') || potentialImageUrl.endsWith('.jpeg') || potentialImageUrl.endsWith('.png'))) {
                 betterImageUrl = potentialImageUrl;
            }
        }

    } catch (e) {
        console.error(`Error fetching/scraping detail page ${link}: ${e.message}`);
    }
    
    return { description, imgUrl: betterImageUrl }; // betterImageUrl will be null if invalid
}


// =================================================================
// --- ADADERANA CORE SCHEDULING LOGIC (Polling System) ---
// =================================================================

/**
 * Checks the pending post queue, tries to resolve the image, and posts to Facebook.
 */
async function checkAndResolvePendingPost(env) {
    const BOT_OWNER_ID = HARDCODED_CONFIG.BOT_OWNER_ID; 
    const pendingRaw = await readKV(env, PENDING_ADADERANA_POST);

    if (!pendingRaw) return; 

    let pending = JSON.parse(pendingRaw);
    pending.retries = (pending.retries || 0) + 1;
    
    // Re-scrape the detail page for the latest image and description (just in case)
    const { description: currentDescription, imgUrl: reScrapedImage } = await reScrapeDetails(pending.link);
    
    // Use the latest description to update the caption, as description might also delay loading
    let cleanDescription = currentDescription.startsWith(pending.title) ? currentDescription.substring(pending.title.length).trim() : currentDescription;
    // Update the pending object's caption with the latest description
    pending.caption = `🚨 බ්‍රේකින් නිවුස් 🚨\n\n${pending.title}\n\n${cleanDescription}\n\n#SriLanka #AdaDerana #BreakingNews`;


    if (reScrapedImage) {
        // --- SUCCESS POSTING (Image Found) ---
        await postNewsWithImageToFacebook(pending.caption, reScrapedImage, env);
        await writeKV(env, LAST_ADADERANA_TITLE_KEY, pending.title);
        await env.NEWS_STATE.delete(PENDING_ADADERANA_POST); // Remove pending item
        
        const successMessage = `🥳 <b>SUCCESS!</b> Ada Derana Post for "${pending.title}" successful.\n(Image resolved on retry ${pending.retries}) - <a href="${pending.link}">View Article</a>`;
        await sendRawTelegramMessage(BOT_OWNER_ID, successMessage, reScrapedImage, null);
        return;

    } else if (pending.retries >= MAX_RETRIES) {
        // --- FALLBACK (Maximum retries reached) ---
        
        let finalImage = pending.initialImgUrl; 
        let finalCaption = pending.caption;

        let fallbackMessage = `⚠️ <b>FALLBACK POST (Max Retries Reached - ${MAX_RETRIES})</b>:\n\nImage for "${pending.title}" failed to resolve.\nPosting with initial thumbnail or text only.`;
        
        try {
            // Attempt to post with the fallback image.
            await postNewsWithImageToFacebook(finalCaption, finalImage, env);
            fallbackMessage += "\n\n✅ Posted successfully using fallback thumbnail.";
        } catch (e) {
            // If even the fallback fails, try text-only
            console.error("Fallback image post failed:", e.message);
            await postNewsWithImageToFacebook(finalCaption, null, env); 
            fallbackMessage = `❌ <b>CRITICAL FALLBACK ERROR:</b> Failed to post image. Posted text only.\nError: <code>${e.message}</code>`;
        }
        
        await sendRawTelegramMessage(BOT_OWNER_ID, fallbackMessage, null, null);
        await writeKV(env, LAST_ADADERANA_TITLE_KEY, pending.title);
        await env.NEWS_STATE.delete(PENDING_ADADERANA_POST); // Clear state
        return;
    } 

    // --- CONTINUE RETRYING ---
    await writeKV(env, PENDING_ADADERANA_POST, JSON.stringify(pending)); 
    console.log(`Image not ready. Retrying in next run. Attempt: ${pending.retries}`);
    
    const retryStatusMessage = `⏳ **Image Check Status** for "${pending.title}": Attempt ${pending.retries}/${MAX_RETRIES} failed. Still holding post.`;
    await sendRawTelegramMessage(BOT_OWNER_ID, retryStatusMessage, null, null);
}


/**
 * Checks Ada Derana homepage for a new title. If found, saves it to PENDING.
 */
async function checkForNewAdaDeranaNews(env) {
    const BOT_OWNER_ID = HARDCODED_CONFIG.BOT_OWNER_ID; 

    try {
        const news = await getLatestAdaDeranaNewsSummary();
        if (!news) {
            console.info(`Ada Derana: No news summary found.`);
            return;
        }

        const lastTitle = await readKV(env, LAST_ADADERANA_TITLE_KEY);
        const currentTitle = news.title;

        if (currentTitle === lastTitle) {
            console.info(`Ada Derana: No new title. Last: ${currentTitle}`);
            return; 
        }
        
        // If there is already a pending post, ignore the new one for now.
        const pendingRaw = await readKV(env, PENDING_ADADERANA_POST);
        if (pendingRaw) {
             console.log("New news found, but there is already a pending post. Skipping.");
             return;
        }

        // --- Initial Details Scrape for description ---
        const { description: initialDescription } = await reScrapeDetails(news.link);
        let cleanDescription = initialDescription.startsWith(news.title) ? initialDescription.substring(news.title.length).trim() : initialDescription;

        // --- New PENDING Post Creation ---
        const pendingPost = {
            title: news.title,
            link: news.link,
            description: cleanDescription,
            initialImgUrl: news.imgUrl, // The thumbnail/initial URL
            retries: 0,
            timestamp: moment().tz(COLOMBO_TIMEZONE).toISOString(),
            caption: `🚨 බ්‍රේකින් නිවුස් 🚨\n\n${news.title}\n\n${cleanDescription}\n\n#SriLanka #AdaDerana #BreakingNews`
        };
        
        // Save to PENDING KV and notify owner, then STOP
        await writeKV(env, PENDING_ADADERANA_POST, JSON.stringify(pendingPost));
        
        const telegramMessage = `✅ <b>Ada Derana New Post Found! (Image Pending)</b>\n\n` +
                                `<b>Title:</b> ${news.title}\n` +
                                `<b>Link:</b> <a href="${news.link}">View Article</a>\n\n` +
                                `Bot will retry checking image validity (${MAX_RETRIES} times). Post is currently held in queue.`;

        await sendRawTelegramMessage(BOT_OWNER_ID, telegramMessage, news.imgUrl, null);
        
    } catch (error) {
        const errorTime = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        const errorMessage = `[${errorTime}] ADADERANA CHECK FAILED: ${error.stack}`;
        console.error("An error occurred during ADADERANA check:", errorMessage);
        
        await writeKV(env, LAST_ERROR_KEY, errorMessage);
        await writeKV(env, LAST_ERROR_TIMESTAMP, errorTime);
        
         await sendRawTelegramMessage(HARDCODED_CONFIG.BOT_OWNER_ID, `❌ <b>CRITICAL ERROR!</b> Ada Derana Check Failed.\n\nTime: ${errorTime}\n\nError: <code>${error.message}</code>`, null);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (Simplified) ---
// =================================================================

/**
 * Generates the Admin status message. (Includes Pending Post info)
 */
async function generateBotStatusMessage(env) {
    const lastError = await readKV(env, LAST_ERROR_KEY);
    const errorTime = await readKV(env, LAST_ERROR_TIMESTAMP);
    const lastCheckedTitle = await readKV(env, LAST_ADADERANA_TITLE_KEY);
    const pendingRaw = await readKV(env, PENDING_ADADERANA_POST);
    const pending = pendingRaw ? JSON.parse(pendingRaw) : null;


    let statusMessage = `🤖 <b>BOT SYSTEM STATUS (ADMIN VIEW)</b> 🤖\n\n`;
    statusMessage += `✅ <b>KV Binding:</b> ${env.NEWS_STATE ? 'OK (Active)' : '❌ FAIL (Missing)'}\n`;
    
    if (pending) {
        statusMessage += `⏳ <b>PENDING POST:</b> ${pending.title}\n`;
        statusMessage += `   - Link: <a href="${pending.link}">View</a>\n`;
        statusMessage += `   - Retries: ${pending.retries}/${MAX_RETRIES}\n\n`;
    } else {
        statusMessage += `✅ <b>PENDING POST:</b> None\n`;
        statusMessage += `📰 <b>Last Posted Title:</b> ${lastCheckedTitle ? `<code>${lastCheckedTitle}</code>` : 'None'}\n\n`;
    }


    if (lastError) {
        statusMessage += `🚨 <b>Last CRITICAL Error</b> (at ${errorTime}):\n` +
                         `<code>${lastError.substring(0, 500)}...</code>\n\n`; 
    } else {
        statusMessage += `✅ <b>Last Error Check:</b> No critical errors recorded.\n\n`;
    }

    statusMessage += `🔥 <b>Tip:</b> Use 'KV RESET' if the bot is stuck.`;
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
         await editTelegramMessage(chatId, messageId, finalCaption, replyMarkup);
    } else {
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
        
        await fetch(`https://api.telegram.org/bot${HARDCODED_CONFIG.TELEGRAM_TOKEN}/answerCallbackQuery?callback_query_id=${update.callback_query.id}`);
    }

    const command = text.split(' ')[0].toLowerCase();
    
    const isOwner = (userId === BOT_OWNER_ID);

    // --- COMMAND EXECUTION ---
    switch (command) {
        case '/start':
        case '/back_admin':
            await sendFinalStartMessage(chatId, userId, isOwner, update.callback_query ? messageId : null, env);
            break;

        case '/botstatus_admin': 
             if (!isOwner) return; 
            
            const statusMessage = await generateBotStatusMessage(env);
            const backKeyboardStatus = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};
            
            await editTelegramMessage(chatId, messageId, statusMessage, backKeyboardStatus);
            break;
            
        case '/resetkv_admin':
             if (!isOwner) return; 
             
            if (env.NEWS_STATE) {
                await env.NEWS_STATE.delete(LAST_ADADERANA_TITLE_KEY);
                await env.NEWS_STATE.delete(LAST_ERROR_KEY);
                await env.NEWS_STATE.delete(LAST_ERROR_TIMESTAMP);
                await env.NEWS_STATE.delete(PENDING_ADADERANA_POST); // Pending post එකද ඉවත් කරයි
            }
            
            const resetMessage = `✅ <b>KV මතකය සාර්ථකව යළි පිහිටුවන ලදී!</b>\nසියලුම පුවත් සහ දෝෂ සටහන් ඉවත් කර ඇත.`;
                
            const backKeyboardReset = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};
            
            await editTelegramMessage(chatId, messageId, resetMessage, backKeyboardReset);
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
    // 1. Always try to resolve the pending post first
    await checkAndResolvePendingPost(env);
    // 2. Then check for new news (which creates a new pending post)
    await checkForNewAdaDeranaNews(env); 
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
