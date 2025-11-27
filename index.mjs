// index.js

/**
 * Cloudflare Worker හි main fetch event handler එක.
 * Context: Cloudflare Workers විසින් මෙම event handler එකට 'env' object එක ලබා දෙන අතර,
 * එහිදී ඔබ විසින් සකස් කරන ලද environment variables (secrets) අඩංගු වේ.
 *
 * @param {Request} request
 * @param {Object} env - Environment Variables (Secrets)
 */
export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') {
            // Webhook එකට POST request පමණක් භාර ගැනීම
            return new Response('Method Not Allowed', { status: 405 });
        }

        try {
            const payload = await request.json();
            const update = payload;

            // Telegram Message එකක් ලැබුණාදැයි පරීක්ෂා කිරීම
            if (update.message) {
                const message = update.message;

                // Bot command එකක්දැයි පරීක්ෂා කිරීම (උදා: /post <message>)
                if (message.text && message.text.startsWith('/post')) {
                    const textToPost = message.text.substring(5).trim(); // /post command එක ඉවත් කිරීම
                    if (textToPost) {
                        await postTextToFacebook(textToPost, env);
                        await sendTelegramResponse(message.chat.id, '✅ Text post successfully sent to Facebook.', env);
                        return new Response('OK', { status: 200 });
                    }
                }
                
                // ඡායාරූපයක් (Photo) හෝ වීඩියෝවක් (Video) පරීක්ෂා කිරීම
                else if (message.photo || message.video) {
                    
                    let file_id;
                    let mediaType;
                    const caption = message.caption || '';
                    
                    if (message.photo) {
                        file_id = message.photo[message.photo.length - 1].file_id; // හොඳම quality එකේ photo එක තෝරා ගැනීම
                        mediaType = 'photo';
                    } else if (message.video) {
                        file_id = message.video.file_id;
                        mediaType = 'video';
                    }

                    if (file_id) {
                        await handleMediaPost(file_id, mediaType, caption, env);
                        await sendTelegramResponse(message.chat.id, `✅ ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} post successfully sent to Facebook.`, env);
                        return new Response('OK', { status: 200 });
                    }
                }
            }

            return new Response('OK - Update received but not processed', { status: 200 });

        } catch (error) {
            console.error('Error processing Telegram update:', error.message);
            // Error එක Telegram chat එකට යැවිය හැක.
            if (payload.message && payload.message.chat) {
                await sendTelegramResponse(payload.message.chat.id, `❌ Error: ${error.message}`, env);
            }
            return new Response('Error Processing Request', { status: 500 });
        }
    }
}

/**
 * Facebook Page එකට text post එකක් යැවීම.
 * @param {string} message - Post කිරීමට ඇති Text එක
 * @param {Object} env - Environment Variables
 */
async function postTextToFacebook(message, env) {
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/feed`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            message: message,
            access_token: env.FACEBOOK_ACCESS_TOKEN,
        }).toString(),
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(`Facebook API Error (Text): ${JSON.stringify(result.error)}`);
    }
}

/**
 * Telegram හරහා ලැබුණු media file එකක් Facebook වෙත යැවීම.
 * @param {string} fileId - Telegram file_id එක
 * @param {string} mediaType - 'photo' or 'video'
 * @param {string} caption - Post එකේ ඇති Caption එක
 * @param {Object} env - Environment Variables
 */
async function handleMediaPost(fileId, mediaType, caption, env) {
    
    // 1. Telegram File Path එක ලබා ගැනීම
    const fileInfoUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`;
    const fileInfoResponse = await fetch(fileInfoUrl);
    const fileInfo = await fileInfoResponse.json();
    
    if (!fileInfo.ok) {
        throw new Error('Could not get Telegram file info from Telegram API.');
    }
    
    const filePath = fileInfo.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    // 2. Facebook Endpoint තීරණය කිරීම
    const isVideo = mediaType === 'video';
    const endpoint = `https://graph.facebook.com/v19.0/${env.FACEBOOK_PAGE_ID}/${isVideo ? 'videos' : 'photos'}`;

    // 3. Facebook API වෙත යැවීම
    const bodyParams = {
        caption: caption,
        access_token: env.FACEBOOK_ACCESS_TOKEN,
    };
    
    if (isVideo) {
        bodyParams.file_url = fileUrl; 
    } else {
        bodyParams.url = fileUrl;
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
        throw new Error(`Facebook API Error (${mediaType}): ${JSON.stringify(result.error)}`);
    }
}

/**
 * Telegram Chat එකකට ප්‍රතිචාර පණිවිඩයක් යැවීම.
 * @param {number} chatId
 * @param {string} text
 * @param {Object} env - Environment Variables
 */
async function sendTelegramResponse(chatId, text, env) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
            }),
        });
    } catch (e) {
        console.error('Failed to send Telegram response:', e);
    }
}
