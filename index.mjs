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

// 🚨 Static Image URL for ultimate fallback (Template Image URL)
const DEFAULT_FALLBACK_IMAGE_URL = 'https://i.postimg.cc/SxcRHnfX/photo-2025-11-28-22-10-46.jpg';

// --- KV KEYS ---
const LAST_ERROR_KEY = 'last_critical_error'; 
const LAST_ERROR_TIMESTAMP = 'last_error_time'; 
const LAST_ADADERANA_TITLE_KEY = 'last_adaderana_title'; 

// --- NEW CONSTANTS FOR MANUAL APPROVAL ---
const APPROVAL_KEYWORDS = [
    'මනුසත් දෙරණ', 'දෙරණ', 'Ada derana', 'derana', 'tv derana'
];
const PENDING_NEWS_KEY_PREFIX = 'PENDING_NEWS_';

// --- START MESSAGE CONSTANTS (Telegram handler සඳහා) ---
const RAW_START_CAPTION_SI = `👋 <b>ආයුබෝවන්!</b>\n\n` +
                             `💁‍♂️ මේ BOT මගින් ඔබගේ <b>CDH News</b> Facebook පිටුව වෙත <b>Ada Derana</b> හි නවතම පුවත් ස්වයංක්‍රීයව පළ කෙරේ.\n\n` +
                             `🎯 මේ BOT පැය 24ම Active එකේ තියෙනවා.🔔.. ✍️\n\n` +
                             `◇───────────────◇\n\n` +
                             `🚀 Developer : @chamoddeshan\n` +
                             `🔥 Mr Chamo Corporation ©\n\n` +
                             `◇───────────────◇`;


// --- Unicode Bold Mapping for Latin and Numeric Characters ---
const BOLD_MAP = {
    '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗',
    'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠', 'h': '𝐡', 'i': '𝐢', 'j': '𝐣', 'k': '𝐤', 'l': '𝐥', 'm': '𝐦', 'n': '𝐧', 'o': '𝐨', 'p': '𝐩', 'q': '𝐪', 'r': '𝐫', 's': '𝐬', 't': '𝐭', 'u': '𝐮', 'v': '𝐯', 'w': '𝐰', 'x': '𝐱', 'y': '𝐲', 'z': '𝐳',
    'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙'
};

/**
 * Converts standard Latin letters and digits to Unicode Bold characters.
 */
function toUnicodeBold(text) {
    let result = '';
    for (const char of text) {
        result += BOLD_MAP[char] || char;
    }
    return result;
}


/**
 * Removes common author credits like (by authorname) from the end of the text.
 */
function removeAuthorCredit(text) {
    const rawAuthorRegex = /\s*\(?by\s+[^\(\)]+\)?\s*$/i; 
    return text.replace(rawAuthorRegex, '').trim();
}

/**
 * Decorates each paragraph of the description by cycling through a set of emojis.
 */
function decorateDescriptionWithEmojis(description) {
    if (!description || description === FALLBACK_DESCRIPTION) {
        return description;
    }
    
    const emojiSet = ['👉', '✨', '📢', '📰', '🔍']; 
    const setLength = emojiSet.length;

    const paragraphs = description.split('\n\n').filter(p => p.trim() !== '');

    const decoratedParagraphs = paragraphs.map((p, i) => {
        const rotatingEmoji = emojiSet[i % setLength]; 
        return `${rotatingEmoji} ${p.trim()}`;
    });

    return decoratedParagraphs.join('\n\n');
}

// =================================================================
// --- 🚨 GEMINI API LOGIC (Translation Only - Still needed for success message) 🚨 ---
// =================================================================

/**
 * Calls the Gemini API for text-based tasks (currently only Translation).
 */
async function callGeminiAPI(env, model, bodyPayload) { 
    if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured in the environment.");
    }

    // Endpoint for text generation
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload), 
    });

    if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(`Gemini API Error (${model}): ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const json = await response.json();
    return json;
}

/**
 * Translates Sinhala text to English using Gemini. (Still executes, but not used in Facebook post)
 */
async function translateText(env, sinhalaText) {
    const model = 'gemini-2.5-flash';
    const bodyPayload = {
        contents: [
            { role: "user", parts: [{ text: `Translate the following Sinhala news headline into a concise, professional English headline (maximum 10 words, using capital letters where appropriate). Output only the English headline, nothing else. Sinhala: "${sinhalaText}"` }] }
        ],
        generationConfig: { 
            temperature: 0.1,
            maxOutputTokens: 2048, 
        }
    };

    try {
        const result = await callGeminiAPI(env, model, bodyPayload);
        
        // --- Robust checking for result structure ---
        if (!result.candidates || result.candidates.length === 0) {
            console.warn("Gemini returned no candidates (Safety or quota issue?). Result:", JSON.stringify(result));
            return null;
        }

        const firstCandidate = result.candidates[0];
        const parts = firstCandidate.content?.parts;

        // Check if the model stopped due to MAX_TOKENS or safety (finishReason)
        if (!parts || parts.length === 0) {
             const finishReason = firstCandidate.finishReason || 'UNKNOWN';
             console.warn(`Gemini candidate has no parts. Finish reason: ${finishReason}.`, JSON.stringify(firstCandidate));
             return null;
        }

        const translated = parts[0].text?.trim();

        // Basic cleanup and ensuring it's uppercase for the banner
        return translated ? translated.toUpperCase().replace(/[\*\`\"]/g, '') : null;
    } catch (e) {
        console.error("Translation failed:", e.message);
        return null; 
    }
}

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
async function writeKV(env, key, value, options = {}) {
    try {
        if (!env.NEWS_STATE) {
            console.error("KV Binding 'NEWS_STATE' is missing in ENV. Write failed.");
            return;
        }
        // Use JSON.stringify if the value is an object for complex storage
        const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        await env.NEWS_STATE.put(key, stringValue, options);  
    } catch (e) {
        console.error(`KV Write Error (${key}):`, e);
    }
}

/**
 * Posts an image or status to the Facebook Page using the Graph API.
 */
async function postNewsWithImageToFacebook(caption, imageUrl, env) {
    
    // Facebook requires a real URL for the /photos endpoint
    const isImagePost = (imageUrl && imageUrl.startsWith('http'));
    
    if (!isImagePost) {
        // This should theoretically not happen if the fallback is working, but it's a safety net
        throw new Error("Cannot post: No valid image URL was provided.");
    }
    
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/photos`;
    
    if (!env.FACEBOOK_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) {
        throw new Error("Missing FACEBOOK_ACCESS_TOKEN or FACEBOOK_PAGE_ID environment variables.");
    }
    
    const bodyParams = {
        caption: caption,
        access_token: env.FACEBOOK_ACCESS_TOKEN,
        url: imageUrl,
    };
    

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(bodyParams).toString(),
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(`Facebook API Error (Image Post) - Endpoint: /photos - Failed URL: ${imageUrl || 'N/A'} - Error: ${JSON.stringify(result.error)}`);
    }
    console.log(`Facebook Post Successful: ${result.id}`);
}


/**
 * Fetches the direct URL for a given Telegram file ID. (Kept for manual post utility)
 */
async function getTelegramFileUrl(fileId) {
    const TELEGRAM_TOKEN = HARDCODED_CONFIG.TELEGRAM_TOKEN;
    if (!TELEGRAM_TOKEN || !fileId) return null;

    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
        const result = await response.json();

        if (response.ok && result.ok && result.result.file_path) {
            const filePath = result.result.file_path;
            return `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
        }
    } catch (e) {
        console.error("Error fetching Telegram file URL:", e);
    }
    return null;
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
 * Scrapes the detail page for the high-quality image and description.
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

        // --- 2. Image (Thumbnail, used for AI generation) ---
        const mainImage = $detail('div.news-banner img').first().attr('src'); 
        if (mainImage) {
            let cleanedImageUrl = mainImage.trim();
            let potentialImageUrl = null;
            
            if (cleanedImageUrl.startsWith('http')) {
                 potentialImageUrl = cleanedImageUrl;
            } else if (cleanedImageUrl.startsWith('/')) {
                 potentialImageUrl = `https://sinhala.adaderana.lk${cleanedImageUrl}`;
            }

            // Image URL validation
            if (potentialImageUrl && potentialImageUrl.length > 50 && (potentialImageUrl.endsWith('.jpg') || potentialImageUrl.endsWith('.jpeg') || potentialImageUrl.endsWith('.png'))) {
                 betterImageUrl = potentialImageUrl;
            }
        }

    } catch (e) {
        console.error(`Error fetching/scraping detail page ${link}: ${e.message}`);
    }
    
    return { description, imgUrl: betterImageUrl }; 
}


// =================================================================
// --- CORE SCHEDULING LOGIC (AI Integration) ---
// =================================================================

/**
 * Executes the full workflow: Translation, Image Handling, Facebook Post, and KV update.
 */
async function executePostWorkflow(news, originalImageUrl, initialDescription, env) {
    
    // --- 1. Preparation of Caption ---
    let cleanDescription = initialDescription.startsWith(news.title) ? initialDescription.substring(news.title.length).trim() : initialDescription;
    cleanDescription = removeAuthorCredit(cleanDescription); 
    const decoratedDescription = decorateDescriptionWithEmojis(cleanDescription); 
    const ctaLine = toUnicodeBold("ඔබේ අදහස කුමක්ද?"); 
    
    const rawCaptionBase = `${decoratedDescription}\n\n` + 
                       `👇 ${ctaLine} 👇\n\n` +  
                       `#SriLanka #CDHNews #BreakingNews`;
    
    // --- 2. Translate Title (for Telegram notification only) ---
    const englishHeadline = await translateText(env, news.title); // Still executes for the success message

    if (!englishHeadline) {
         console.warn(`Headline translation failed for: ${news.title}. Continuing without English headline.`);
    }
    
    // --- 3. Determine Final Image URL ---
    let finalImageUrl;
    let postImageSource;

    if (originalImageUrl) {
        finalImageUrl = originalImageUrl;
        postImageSource = "Scraped Original";
    } else {
        // Use the fallback URL as requested
        finalImageUrl = DEFAULT_FALLBACK_IMAGE_URL;
        postImageSource = "Static Fallback (Template)";
    }

    if (!finalImageUrl) {
        throw new Error(`Posting aborted for "${news.title}": No valid image URL was found.`);
    }

    // --- 4. CREATE FINAL CAPTION (English Headline is excluded) ---
    
    // 📰 Sinhala Headline (For content clarity)
    const originalHeadlineLine = toUnicodeBold(`📰 ${news.title}`);
    
    // Combine everything: Sinhala Headline, and then Description/CTA
    const finalCaptionForFacebook = `${originalHeadlineLine}\n\n` +
                                    toUnicodeBold(rawCaptionBase);


    // --- 5. Post to Facebook ---
    await postNewsWithImageToFacebook(finalCaptionForFacebook, finalImageUrl, env);
    
    // --- 6. Update KV and Notify Owner (Only update KV if the post was successful) ---
    await writeKV(env, LAST_ADADERANA_TITLE_KEY, news.title);
    
    const telegramMessage = `✅ <b>SUCCESS!</b> Ada Derana Post for "${news.title}" successful.\n(Headline translated: ${englishHeadline || 'Failed/Skipped'}).\n(Image source: ${postImageSource}).\n\n<b>Final Image URL:</b> <a href="${finalImageUrl}">View Image</a>\n<b>Link:</b> <a href="${news.link}">View Article</a>`;
    await sendRawTelegramMessage(HARDCODED_CONFIG.BOT_OWNER_ID, telegramMessage, finalImageUrl, null);
}

/**
 * Checks Ada Derana homepage for a new title. If found, translates, generates image, and posts immediately.
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

        // --- 1. Scrape Details (Description & Best Image URL) ---
        const { description: initialDescription, imgUrl: originalImageUrl } = await reScrapeDetails(news.link);
        
        // --- 2. Keyword Check for Manual Approval ---
        const combinedText = (news.title + " " + initialDescription).toLowerCase();
        const needsApproval = APPROVAL_KEYWORDS.some(keyword => combinedText.includes(keyword.toLowerCase()));

        if (needsApproval) {
            // STOP AUTOMATIC FLOW, ASK FOR APPROVAL
            const uniqueId = Date.now().toString(); // Use timestamp as unique ID
            const pendingKey = PENDING_NEWS_KEY_PREFIX + uniqueId;
            
            // Store necessary data for later execution (use object store)
            const pendingData = { 
                newsTitle: news.title, 
                newsLink: news.link, 
                description: initialDescription, 
                imageUrl: originalImageUrl 
            };
            
            // Store for 1 hour (3600 seconds) - use options object
            await writeKV(env, pendingKey, pendingData, { expirationTtl: 3600 });
            
            const approvalMessage = `🛑 **MANUAL APPROVAL REQUIRED** 🛑\n\n` +
                                    `<b>Filter Alert:</b> A protected keyword was found in the headline/article. This post is currently blocked.\n\n` +
                                    `<b>Headline:</b> ${news.title}\n` +
                                    `<b>Link:</b> <a href="${news.link}">View Article</a>\n\n` +
                                    `Do you wish to manually approve and post this item?`;
            
            const approvalKeyboard = { inline_keyboard: [
                [{ text: '✅ Approve and Post', callback_data: `approve:${uniqueId}` }],
                [{ text: '❌ Cancel Post', callback_data: `cancel:${uniqueId}` }]
            ]};
            
            // Send message to the owner for approval
            await sendRawTelegramMessage(BOT_OWNER_ID, approvalMessage, null, approvalKeyboard);
            
            // Important: Update KV with the current title to prevent re-triggering this item immediately.
            await writeKV(env, LAST_ADADERANA_TITLE_KEY, news.title);
            
            console.log(`News requires manual approval: ${news.title}`);
            return; // EXIT the function

        }

        // --- 3. If no approval needed, proceed with automatic post ---
        await executePostWorkflow(news, originalImageUrl, initialDescription, env); 
        
    } catch (error) {
        const errorTime = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        const errorMessage = `[${errorTime}] ADADERANA CHECK FAILED: ${error.stack}`;
        console.error("An error occurred during ADADERANA check:", errorMessage);
        
        await writeKV(env, LAST_ERROR_KEY, errorMessage);
        await writeKV(env, LAST_ERROR_TIMESTAMP, errorTime);
        
         // Send the notification message here
         await sendRawTelegramMessage(HARDCODED_CONFIG.BOT_OWNER_ID, `❌ <b>CRITICAL ERROR!</b> Ada Derana Check Failed.\n\nTime: ${errorTime}\n\nError: <code>${error.message}</code>`, null);
    }
}


// =================================================================
// --- TELEGRAM WEBHOOK HANDLER (Simplified) ---
// =================================================================

/**
 * Generates the Admin status message. 
 */
async function generateBotStatusMessage(env) {
    const lastError = await readKV(env, LAST_ERROR_KEY);
    const errorTime = await readKV(env, LAST_ERROR_TIMESTAMP);
    const lastCheckedTitle = await readKV(env, LAST_ADADERANA_TITLE_KEY);


    let statusMessage = `🤖 <b>BOT SYSTEM STATUS (ADMIN VIEW)</b> 🤖\n\n`;
    statusMessage += `✅ <b>KV Binding:</b> ${env.NEWS_STATE ? 'OK (Active)' : '❌ FAIL (Missing)'}\n`;
    
    // Updated Status: AI Image is OFF, Translation is ON
    statusMessage += `⚙️ <b>AI Mode:</b> Translation (ON), Image Generation (OFF - Template not possible in Worker)\n`; 
    statusMessage += `📰 <b>Last Posted Title:</b> ${lastCheckedTitle ? `<code>${lastCheckedTitle}</code>` : 'None'}\n\n`;


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
        text = update.message.text || update.message.caption || '';
    } else if (update.callback_query) {
        userId = update.callback_query.from.id;
        chatId = update.callback_query.message.chat.id;
        messageId = update.callback_query.message.message_id;
        text = update.callback_query.data;
        
        // Answer the callback query to remove the loading state
        await fetch(`https://api.telegram.org/bot${HARDCODED_CONFIG.TELEGRAM_TOKEN}/answerCallbackQuery?callback_query_id=${update.callback_query.id}`);
    }

    const command = update.message && update.message.text ? update.message.text.split(' ')[0].toLowerCase() : text.toLowerCase().split(':')[0];
    
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
            }
            
            const resetMessage = `✅ <b>KV මතකය සාර්ථකව යළි පිහිටුවන ලදී!</b>\nසියලුම පුවත් සහ දෝෂ සටහන් ඉවත් කර ඇත.`;
                
            const backKeyboardReset = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};
            
            await editTelegramMessage(chatId, messageId, resetMessage, backKeyboardReset);
            break;
            
        // --- MANUAL APPROVAL HANDLER ---
        case 'approve':
        case 'cancel':
            if (!isOwner) {
                 await sendRawTelegramMessage(chatId, "⚠️ Only the bot owner can use this feature.", null, null, messageId);
                 return;
            }
            
            const [action, uniqueId] = text.split(':');
            const pendingKey = PENDING_NEWS_KEY_PREFIX + uniqueId;
            
            let pendingDataString = await readKV(env, pendingKey);
            
            if (!pendingDataString) {
                const expiredMessage = `⚠️ **ERROR:** This pending post data has expired or was already processed.`;
                await editTelegramMessage(chatId, messageId, expiredMessage);
                return;
            }
            
            // Delete key immediately to prevent double processing
            await env.NEWS_STATE.delete(pendingKey);
            
            let pendingData;
            try {
                pendingData = JSON.parse(pendingDataString);
            } catch(e) {
                 const parseErrorMessage = `⚠️ **ERROR:** Failed to parse pending data.`;
                 await editTelegramMessage(chatId, messageId, parseErrorMessage);
                 return;
            }
            
            const backKeyboard = { inline_keyboard: [
                [{ text: '⬅️ Back to Admin Menu', callback_data: '/start' }]
            ]};


            if (action === 'approve') {
                try {
                    // Reconstruct news object for the workflow function
                    const newsToPost = { title: pendingData.newsTitle, link: pendingData.newsLink };
                    
                    const approvalStartMessage = `⏳ **APPROVAL IN PROGRESS...**\n\nStarting translation and posting for: <b>${pendingData.newsTitle}</b>`;
                    await editTelegramMessage(chatId, messageId, approvalStartMessage);
                    
                    // EXECUTE FULL WORKFLOW
                    await executePostWorkflow(newsToPost, pendingData.imageUrl, pendingData.description, env);
                    
                    const successMessage = `✅ **POST APPROVED & PUBLISHED** ✅\n\n` +
                                           `Headline: <b>${pendingData.newsTitle}</b>\n` +
                                           `Status: Successfully translated and posted to Facebook.`;
                    await editTelegramMessage(chatId, messageId, successMessage, backKeyboard);
                    
                } catch (e) {
                    const failMessage = `❌ **APPROVAL FAILED!** ❌\n\n` +
                                        `Headline: <b>${pendingData.newsTitle}</b>\n` +
                                        `Error during posting: <code>${e.message.substring(0, 300)}...</code>`;
                    await editTelegramMessage(chatId, messageId, failMessage, backKeyboard);
                    console.error("Manual approval post failed:", e.stack);
                }
            } else if (action === 'cancel') {
                 const cancelMessage = `❌ **POST CANCELLED** ❌\n\n` +
                                       `Headline: <b>${pendingData.newsTitle}</b>\n` +
                                       `Status: This post was successfully blocked and will not be sent to Facebook.`;
                 await editTelegramMessage(chatId, messageId, cancelMessage, backKeyboard);
            }
            break; // End of approval handler

        // ... rest of the command cases
    }
    
    
    // --- 🚨 MANUAL FACEBOOK POSTING LOGIC (Owner Only) 🚨 ---
    if (isOwner && update.message && !command.startsWith('/')) {
        
        let caption = update.message.text || update.message.caption || '';
        let mediaUrl = null;
        let fileId = null;
        let contentType = 'Text';

        if (update.message.photo) {
            fileId = update.message.photo.pop().file_id;
            contentType = 'Photo';
        } else if (update.message.video) {
            fileId = update.message.video.file_id;
            contentType = 'Video';
        }

        try {
            if (fileId) {
                mediaUrl = await getTelegramFileUrl(fileId);
                
                if (mediaUrl) {
                    let cleanCaption = removeAuthorCredit(caption);
                    const decoratedDescription = decorateDescriptionWithEmojis(cleanCaption);
                    const ctaLine = toUnicodeBold("ඔබේ අදහස කුමක්ද?");
                    
                    caption = `${decoratedDescription}\n\n` + 
                              `👇 ${ctaLine} 👇\n\n` +  
                              `#CDHNews #ManualPost`;
                              
                } else {
                    caption = `📣 **Manual Post (File Fetch Failed!)**\n\n${caption}\n\n#CDHNews`;
                }

            } else if (!caption) {
                await sendRawTelegramMessage(chatId, "⚠️ **Manual Post Failed:** Cannot post an empty message without media.", null, null, messageId);
                return new Response('OK', { status: 200 }); 
            }
            
            const finalCaption = toUnicodeBold(caption);
            await postNewsWithImageToFacebook(finalCaption, mediaUrl, env);

            let successMessage = `✅ **Facebook Post Successful!**\n\nContent Type: ${contentType}\nCaption: <code>${finalCaption.substring(0, 100)}...</code>`;
            await sendRawTelegramMessage(chatId, successMessage, null, null, messageId);

        } catch (e) {
            let errorMessage = `❌ **Facebook Manual Post Failed!**\n\nContent Type: ${contentType}\nError: <code>${e.message}</code>`;
            await sendRawTelegramMessage(chatId, errorMessage, null, null, messageId);
        }
    }
    // --- 🚨 END MANUAL FACEBOOK POSTING LOGIC 🚨 ---
    
    
    // Default reply if not a command and not a manual post (and not handled above)
    if (update.message && !command.startsWith('/')) {
         const defaultReplyText = `පවතින විධානයන් බැලීමට /start යොදන්න.`;
         await sendRawTelegramMessage(chatId, defaultReplyText, null, null, messageId); 
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// =================================================================

async function handleScheduledTasks(env) {
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
