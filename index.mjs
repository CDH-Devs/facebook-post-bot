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
    BOT_OWNER_ID: 1901997764, 
    WORKER_BASE_URL: 'https://fbpostbot.deshanchamod174.workers.dev/', // 🚨 මෙය වෙනස් කරන්න
};

// --- Constants ---
const COLOMBO_TIMEZONE = 'Asia/Colombo';
const HEADERS = {  
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

const ADADERANA_NEWS_URL = 'https://sinhala.adaderana.lk/sinhala-hot-news.php'; 
const FALLBACK_DESCRIPTION = "⚠️ සම්පූර්ණ ලිපිය ලබාගැනීමට නොහැකි විය. කරුණාකර වෙබ් අඩවිය පරීක්ෂා කරන්න.";

// --- KV KEYS ---
const LAST_ERROR_KEY = 'last_critical_error'; 
const LAST_ERROR_TIMESTAMP = 'last_error_time'; 
const LAST_ADADERANA_TITLE_KEY = 'last_adaderana_title'; 

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
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/photos`;
    
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
        throw new Error(`Facebook API Error (Image Post): ${JSON.stringify(result.error)}`);
    }
    console.log(`Facebook Post Successful: ${result.id}`);
}

// KV Read/Write Functions (පෙර පරිදිම ඇත)
async function readKV(env, key) { /* ... implementation ... */
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
async function writeKV(env, key, value) { /* ... implementation ... */
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
// (Telegram messaging functions sendRawTelegramMessage, editTelegramMessage are assumed to be present and unchanged)
// Telegram Functions ඉහත කේතයේ දී ඇති පරිදිම භාවිත කරන්න.

// =================================================================
// --- CORE ADADERANA NEWS LOGIC (Using Cheerio) - 🚨 UPDATE HERE 🚨 ---
// =================================================================

async function getLatestAdaDeranaNews() {
    const AD_URL = ADADERANA_NEWS_URL;
    
    // --- 1. Summary Page Fetch: Title, Link, Thumbnail ---
    const resp = await fetch(AD_URL, { headers: HEADERS });
    if (!resp.ok) throw new Error(`[AD SCRAPING ERROR] HTTP error! status: ${resp.status} on news page.`);

    const html = await resp.text();
    const $ = load(html);
    
    const newsStory = $('.news-story').first(); 
    if (newsStory.length === 0) return null;

    const titleLinkTag = newsStory.find('h2 a');
    const title = titleLinkTag.text().trim().replace(/\s{2,}/g, ' ').replace(/&nbsp;/g, ' '); 
    let link = titleLinkTag.attr('href');
    
    // Thumbnail (as fallback) - This is what you identified in the hot-news page
    const imgTagThumb = newsStory.find('.thumb-image img');
    let imgUrl = imgTagThumb.attr('src'); 
    
    if (link && !link.startsWith('http')) {
        link = "https://sinhala.adaderana.lk/" + link;
    }

    if (!title || !link) return null;

    // --- 2. Detail Page Fetch: Description and Higher Quality Image ---
    let description = "";
    let betterImageUrl = imgUrl; // Start with the thumbnail

    try {
        const detailResp = await fetch(link, { headers: HEADERS });
        if (!detailResp.ok) throw new Error(`[AD DETAIL ERROR] HTTP error! status: ${detailResp.status} on detail page.`);

        const detailHtml = await detailResp.text();
        const $detail = load(detailHtml);
        
        // 2a. Description Scraping: 🚨 ඔබගේ screenshot අනුව නිවැරදි selector එක භාවිතා කිරීම
        let paragraphs = [];
        $detail('div.news-content p').each((i, el) => { 
            const pText = $detail(el).text().trim();
            // Filter out empty lines and "24/7" ads/headers if present
            if (pText.length > 20 && !pText.startsWith('24/7')) { 
                 paragraphs.push(pText);
            }
        });
        
        // පුවත් විස්තරය Title එකත් සමඟ ඇතිනම්, එය ඉවත් කිරීම අවශ්‍ය නොවේ.
        description = paragraphs.join('\n\n').trim();
        if (description.length < 50) { // If scraping failed to get enough content
             description = FALLBACK_DESCRIPTION;
        }


        // 2b. High Quality Image Scraping: 🚨 ඔබගේ screenshot අනුව නිවැරදි selector එක භාවිතා කිරීම
        const mainImage = $detail('div.news-banner img').first().attr('src'); 
        if (mainImage) {
            // Ada Derana බොහෝ විට Full URLs භාවිත කරන නිසා, base URL එක එකතු කරන්නේ නැත.
            // එන image URL එක https://s3.amazonaws.com... ලෙස තිබේ.
            betterImageUrl = mainImage;
        }

    } catch (e) {
        console.error(`Error fetching/scraping detail page ${link}: ${e.message}`);
        description = FALLBACK_DESCRIPTION;
    }
    
    return { title, link, imgUrl: betterImageUrl, description };
}

// =================================================================
// --- ADADERANA SCHEDULED TASK (Facebook Posting) - 🚨 UPDATE CAPTION 🚨 ---
// =================================================================

async function fetchAdaDeranaNews(env) {
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
        // විස්තරය Title එකෙන් ආරම්භ වේ නම්, Title එක ඉවත් කිරීම.
        if (cleanDescription.startsWith(news.title)) {
            cleanDescription = cleanDescription.substring(news.title.length).trim();
        }
        
        // --- 2. Construct Message and Post to Facebook ---
        const caption = `🚨 බ්‍රේකින් නිවුස් 🚨\n\n` +
                        `${news.title}\n\n` +
                        `${cleanDescription}\n\n` + 
                        `#SriLanka #AdaDerana #BreakingNews`; 
        
        // Image URL එක දැන් Detail page එකෙන් ලබාගත් High Quality එක වේ.
        await postNewsWithImageToFacebook(caption, news.imgUrl, env);
        
        // --- 3. Store Last Posted Title ---
        await writeKV(env, LAST_ADADERANA_TITLE_KEY, currentTitle);
        
    } catch (error) {
        const errorTime = moment().tz(COLOMBO_TIMEZONE).format('YYYY-MM-DD hh:mm A');
        const errorMessage = `[${errorTime}] ADADERANA TASK FAILED: ${error.stack}`;
        console.error("An error occurred during ADADERANA task:", errorMessage);
        
        await writeKV(env, LAST_ERROR_KEY, errorMessage);
        await writeKV(env, LAST_ERROR_TIMESTAMP, errorTime);
    }
}


// =================================================================
// --- CLOUDFLARE WORKER HANDLERS ---
// (පෙර පරිදිම, Telegram Admin Logic සහ Handlers ඇතුළත් කර ඇත)
// =================================================================

// (Handle Scheduled Tasks and Fetch Handlers are assumed to be present and unchanged)
async function handleScheduledTasks(env) {
    await fetchAdaDeranaNews(env); 
}

export default {
    async scheduled(event, env, ctx) {
        // ... (scheduled implementation) ...
    },

    async fetch(request, env, ctx) {
        // ... (fetch implementation including /trigger and POST handler for Telegram) ...
        try {
            const url = new URL(request.url);

            if (url.pathname === '/trigger') {
                await handleScheduledTasks(env);
                return new Response("Ada Derana Facebook Bot manually triggered. Check Worker Logs.", { status: 200 });
            }
            
            if (request.method === 'POST') {
                const update = await request.json();
                // Telegram update handler function එක මෙහිදී කැඳවනු ලැබේ.
                // (handleTelegramUpdate function එක පෙර කේතයේ තිබූ පරිදිම භාවිත කරන්න)
                // එය Admin Commands (/botstatus_admin, /resetkv_admin) සඳහා පමණක් අදාල වේ.
                return new Response('OK', { status: 200 });
            }

            return new Response('Ada Derana Facebook Bot is ready.', { status: 200 });
            
        } catch (e) {
            console.error('[CRITICAL FETCH FAILURE]:', e.stack);
            return new Response(`Worker threw an unhandled exception: ${e.message}.`, { status: 500 });
        }
    }
};
// ⚠️ Note: Telegram utility functions and the handleTelegramUpdate function (which handles /start, /botstatus_admin, etc.) 
// should be copied from the previous complete code block into this new one for it to be fully functional.
