// enhanced-scraper.js

const https = require('https');
const querystring = require('querystring');
const zlib = require('zlib');

/**
 * Enhanced headers untuk bypass Cloudflare
 */
function getEnhancedHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
    };
}

/**
 * Retry mechanism dengan exponential backoff
 */
async function retryRequest(requestFunc, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await requestFunc();
            return result;
        } catch (error) {
            console.log(`Attempt ${attempt} failed:`, error.message);
            
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Exponential backoff with jitter
            const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
            console.log(`Waiting ${Math.round(delay)}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Check jika response adalah Cloudflare challenge
 */
function isCloudflareChallenge(html) {
    return html.includes('Just a moment...') || 
           html.includes('Enable JavaScript and cookies to continue') ||
           html.includes('challenge-platform');
}

/**
 * Mengambil token dan cookie dari halaman utama dengan retry
 */
function getTokenAndCookie(url, headers) {
    return new Promise((resolve, reject) => {
        const options = {
            timeout: 30000,
            headers: headers
        };

        const req = https.get(url, options, (res) => {
            let chunks = [];
            const cookie = res.headers['set-cookie']?.join('; ') || '';
            const encoding = res.headers['content-encoding'];

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                let buffer = Buffer.concat(chunks);

                // Decompress if needed
                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decoded) => {
                        if (err) return reject(err);
                        handleHtml(decoded.toString());
                    });
                } else if (encoding === 'br') {
                    zlib.brotliDecompress(buffer, (err, decoded) => {
                        if (err) return reject(err);
                        handleHtml(decoded.toString());
                    });
                } else if (encoding === 'deflate') {
                    zlib.inflate(buffer, (err, decoded) => {
                        if (err) return reject(err);
                        handleHtml(decoded.toString());
                    });
                } else {
                    handleHtml(buffer.toString());
                }

                function handleHtml(html) {
                    // ...your existing logic...
                    if (isCloudflareChallenge(html)) {
                        reject(new Error('Detected Cloudflare challenge page. Request blocked by anti-bot protection.'));
                        return;
                    }

                    console.log('Response length:', html.length);
                    console.log('First 500 chars:', html.substring(0, 500));

                    const tokenRegex = /authenticityToken = '([a-f0-9]+)';/;
                    const match = html.match(tokenRegex);

                    if (match && match[1]) {
                        resolve({ token: match[1], cookie: cookie });
                    } else {
                        // Try alternative token patterns
                        const altTokenRegex = /_token['"]\s*:\s*['"]([^'"]+)['"]/;
                        const altMatch = html.match(altTokenRegex);

                        if (altMatch && altMatch[1]) {
                            resolve({ token: altMatch[1], cookie: cookie });
                        } else {
                            reject(new Error('Token tidak ditemukan dalam response HTML\n' + html));
                        }
                    }
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Request error: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.setTimeout(30000);
    });
}

/**
 * Enhanced POST request dengan better error handling
 */
function postForTenderData(url, payload, headers) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify(payload);
        const urlObject = new URL(url);

        const options = {
            hostname: urlObject.hostname,
            path: urlObject.pathname + urlObject.search,
            method: 'POST',
            timeout: 30000,
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(postData),
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        const req = https.request(options, (res) => {
            let chunks = [];
            const encoding = res.headers['content-encoding'];

            res.on('data', (chunk) => {
                chunks.push(chunk);
            });

            res.on('end', () => {
                let buffer = Buffer.concat(chunks);

                function handleJsonResponse(jsonResponse) {
                    // Check if response is Cloudflare challenge
                    if (isCloudflareChallenge(jsonResponse)) {
                        reject(new Error('POST request blocked by Cloudflare'));
                        return;
                    }
                    try {
                        console.log('Raw response:', jsonResponse.substring(0, 1000)); // Debug print
                        const parsed = JSON.parse(jsonResponse);
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON response: ${e.message}`));
                    }
                }

                // Decompress if needed
                if (encoding === 'gzip') {
                    zlib.gunzip(buffer, (err, decoded) => {
                        if (err) return reject(err);
                        handleJsonResponse(decoded.toString());
                    });
                } else if (encoding === 'br') {
                    zlib.brotliDecompress(buffer, (err, decoded) => {
                        if (err) return reject(err);
                        handleJsonResponse(decoded.toString());
                    });
                } else if (encoding === 'deflate') {
                    zlib.inflate(buffer, (err, decoded) => {
                        if (err) return reject(err);
                        handleJsonResponse(decoded.toString());
                    });
                } else {
                    handleJsonResponse(buffer.toString());
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`POST request error: ${e.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('POST request timeout'));
        });

        req.setTimeout(30000);
        req.write(postData);
        req.end();
    });
}

/**
 * Main function dengan enhanced error handling dan retry logic
 */
async function fetchTenderData(year, pageNumber = 1, pageSize = 10) {
    const baseUrl = 'https://spse.inaproc.id/kemkes';
    const lelangPageUrl = `${baseUrl}/lelang`;
    const dataUrl = `${baseUrl}/dt/lelang?tahun=${year}`;

    try {
        console.log(`Starting fetch for year: ${year}, page: ${pageNumber}, size: ${pageSize}`);

        // Step 1: Get token and cookie with retry
        const { token, cookie } = await retryRequest(
            () => getTokenAndCookie(lelangPageUrl, getEnhancedHeaders()),
            3,
            2000
        );

        console.log('Successfully obtained token and cookie');

        // Step 2: Build payload
        const start = (pageNumber - 1) * pageSize;
        const payload = {
            'draw': pageNumber,
            'columns[0][data]': '0', 'columns[0][name]': '', 'columns[0][searchable]': 'true', 'columns[0][orderable]': 'true', 'columns[0][search][value]': '', 'columns[0][search][regex]': 'false',
            'columns[1][data]': '1', 'columns[1][name]': '', 'columns[1][searchable]': 'true', 'columns[1][orderable]': 'true', 'columns[1][search][value]': '', 'columns[1][search][regex]': 'false',
            'columns[2][data]': '2', 'columns[2][name]': '', 'columns[2][searchable]': 'true', 'columns[2][orderable]': 'true', 'columns[2][search][value]': '', 'columns[2][search][regex]': 'false',
            'columns[3][data]': '3', 'columns[3][name]': '', 'columns[3][searchable]': 'false', 'columns[3][orderable]': 'false', 'columns[3][search][value]': '', 'columns[3][search][regex]': 'false',
            'columns[4][data]': '4', 'columns[4][name]': '', 'columns[4][searchable]': 'true', 'columns[4][orderable]': 'true', 'columns[4][search][value]': '', 'columns[4][search][regex]': 'false',
            'columns[5][data]': '5', 'columns[5][name]': '', 'columns[5][searchable]': 'true', 'columns[5][orderable]': 'true', 'columns[5][search][value]': '', 'columns[5][search][regex]': 'false',
            'order[0][column]': '5', 'order[0][dir]': 'desc',
            'start': start,
            'length': pageSize,
            'search[value]': '',
            'search[regex]': 'false',
            'authenticityToken': token
        };

        // Step 3: POST request with enhanced headers
        const headersForPost = {
            ...getEnhancedHeaders(),
            'Cookie': cookie,
            'Referer': lelangPageUrl,
            'Origin': 'https://spse.inaproc.id'
        };

        // Add random delay to seem more human-like
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

        const tenderData = await retryRequest(
            () => postForTenderData(dataUrl, payload, headersForPost),
            2,
            3000
        );

        console.log('Successfully fetched tender data');

        return {
            success: true,
            data: tenderData,
            metadata: { year, pageNumber, pageSize }
        };

    } catch (error) {
        console.error("Enhanced scraper error:", error.message);
        
        // Provide more specific error messages
        let errorMessage = error.message;
        if (error.message.includes('Cloudflare')) {
            errorMessage = 'Request blocked by anti-bot protection. This is common when accessing from cloud servers.';
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Request timeout. The server may be overloaded or blocking requests.';
        } else if (error.message.includes('Token tidak ditemukan')) {
            errorMessage = 'Unable to extract authentication token from the webpage.';
        }
        
        return {
            success: false,
            error: errorMessage,
            originalError: error.message
        };
    }
}

module.exports = { fetchTenderData };