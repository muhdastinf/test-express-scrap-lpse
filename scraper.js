// alternative-scraper.js

const https = require('https');
const querystring = require('querystring');

/**
 * Strategy 1: Try without authentication token (some APIs accept requests without CSRF)
 */
async function tryWithoutToken(url, payload, headers) {
    const payloadWithoutToken = { ...payload };
    delete payloadWithoutToken.authenticityToken;
    
    return postForTenderData(url, payloadWithoutToken, headers);
}

/**
 * Strategy 2: Try with common default tokens
 */
async function tryWithCommonTokens(url, payload, headers) {
    const commonTokens = [
        '', // empty token
        'null',
        'undefined',
        '1',
        'test',
        'token',
        'csrf',
        'anonymous'
    ];
    
    for (const token of commonTokens) {
        try {
            const payloadWithToken = { ...payload, authenticityToken: token };
            const result = await postForTenderData(url, payloadWithToken, headers);
            
            // Check if response is valid (not error)
            if (result && !result.error && result.data !== undefined) {
                console.log(`Success with token: "${token}"`);
                return result;
            }
        } catch (error) {
            console.log(`Failed with token "${token}":`, error.message);
            continue;
        }
    }
    
    throw new Error('All common tokens failed');
}

/**
 * Strategy 3: Try to bypass CSRF by using different request methods
 */
async function tryAlternativeMethod(baseUrl, year, pageNumber, pageSize, headers) {
    // Try GET method with parameters
    const getUrl = `${baseUrl}/dt/lelang?tahun=${year}&start=${(pageNumber - 1) * pageSize}&length=${pageSize}&draw=${pageNumber}`;
    
    return new Promise((resolve, reject) => {
        https.get(getUrl, { headers }, (res) => {
            let jsonResponse = '';
            res.setEncoding('utf8');
            
            res.on('data', (chunk) => {
                jsonResponse += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(jsonResponse);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`GET method failed: ${e.message}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Strategy 4: Try to extract token from different pages
 */
async function tryDifferentPages(baseUrl, headers) {
    const pages = [
        `${baseUrl}/lelang`,
        `${baseUrl}/`,
        `${baseUrl}/beranda`,
        `${baseUrl}/login`,
        baseUrl.replace('/kemkes', '') // Try root domain
    ];
    
    for (const pageUrl of pages) {
        try {
            console.log(`Trying to get token from: ${pageUrl}`);
            const { token } = await getTokenFromPage(pageUrl, headers);
            if (token) {
                console.log(`Token found on page: ${pageUrl}`);
                return { token, page: pageUrl };
            }
        } catch (error) {
            console.log(`Failed to get token from ${pageUrl}:`, error.message);
            continue;
        }
    }
    
    throw new Error('No token found on any page');
}

/**
 * Enhanced token extraction with multiple patterns
 */
function extractTokenFromHtml(html) {
    const patterns = [
        // Original pattern
        /authenticityToken = '([a-f0-9]+)';/,
        /authenticityToken:\s*['"]([^'"]+)['"]/,
        
        // Meta tags
        /<meta\s+name=['"](csrf-token|_token)['"]\s+content=['"]([^'"]+)['"]/, 
        /<meta\s+content=['"]([^'"]+)['"]\s+name=['"](csrf-token|_token)['"]/, 
        
        // Input fields
        /<input[^>]*name=['"](.*token.*)['"]*[^>]*value=['"]([^'"]+)['"]/, 
        /<input[^>]*value=['"]([^'"]+)['"]*[^>]*name=['"](.*token.*)['"]/, 
        
        // JavaScript variables
        /window\.[^=]*token[^=]*=\s*['"]([^'"]+)['"]/,
        /var\s+[^=]*token[^=]*=\s*['"]([^'"]+)['"]/, 
        /let\s+[^=]*token[^=]*=\s*['"]([^'"]+)['"]/,
        /const\s+[^=]*token[^=]*=\s*['"]([^'"]+)['"]/, 
        
        // Data attributes
        /data-[^=]*token[^=]*=['"]([^'"]+)['"]/,
        
        // Laravel style
        /"csrf_token"\s*:\s*"([^"]+)"/,
        /'csrf_token'\s*:\s*'([^']+)'/,
        
        // Generic token patterns
        /"token"\s*:\s*"([^"]+)"/,
        /'token'\s*:\s*'([^']+)'/
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            // Return the first capturing group that's not undefined
            return match.find((group, index) => index > 0 && group && group.length > 10);
        }
    }
    
    return null;
}

/**
 * Get token from specific page
 */
function getTokenFromPage(url, headers) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers, timeout: 15000 }, (res) => {
            let html = '';
            const cookie = res.headers['set-cookie']?.join('; ') || '';
            
            res.setEncoding('utf8');
            
            res.on('data', (chunk) => {
                html += chunk;
            });

            res.on('end', () => {
                const token = extractTokenFromHtml(html);
                resolve({ token, cookie, html: html.substring(0, 1000) });
            });

        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Enhanced POST function
 */
function postForTenderData(url, payload, headers) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify(payload);
        const urlObject = new URL(url);

        const options = {
            hostname: urlObject.hostname,
            path: urlObject.pathname + urlObject.search,
            method: 'POST',
            timeout: 20000,
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(postData),
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        const req = https.request(options, (res) => {
            let jsonResponse = '';
            res.setEncoding('utf8');
            
            res.on('data', (chunk) => {
                jsonResponse += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(jsonResponse);
                    resolve(parsed);
                } catch (e) {
                    // If not JSON, might still be successful HTML response
                    if (res.statusCode === 200 && jsonResponse.includes('data')) {
                        resolve({ data: jsonResponse, raw: true });
                    } else {
                        reject(new Error(`JSON parse failed: ${e.message}. Response: ${jsonResponse.substring(0, 500)}`));
                    }
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

        req.setTimeout(20000);
        req.write(postData);
        req.end();
    });
}

/**
 * Main function with multiple fallback strategies
 */
async function fetchTenderDataWithFallback(year, pageNumber = 1, pageSize = 10) {
    const baseUrl = 'https://spse.inaproc.id/kemkes';
    const dataUrl = `${baseUrl}/dt/lelang?tahun=${year}`;
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
    };

    // Build base payload
    const start = (pageNumber - 1) * pageSize;
    const basePayload = {
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
        'search[regex]': 'false'
    };

    const strategies = [
        {
            name: 'Without Token',
            execute: () => tryWithoutToken(dataUrl, basePayload, headers)
        },
        {
            name: 'Alternative GET Method',
            execute: () => tryAlternativeMethod(baseUrl, year, pageNumber, pageSize, headers)
        },
        {
            name: 'Common Tokens',
            execute: () => tryWithCommonTokens(dataUrl, { ...basePayload, authenticityToken: '' }, headers)
        },
        {
            name: 'Token from Different Pages',
            execute: async () => {
                const { token } = await tryDifferentPages(baseUrl, headers);
                return postForTenderData(dataUrl, { ...basePayload, authenticityToken: token }, headers);
            }
        }
    ];

    let lastError;
    
    for (const strategy of strategies) {
        try {
            console.log(`Trying strategy: ${strategy.name}`);
            const result = await strategy.execute();
            
            console.log(`✓ Success with strategy: ${strategy.name}`);
            return {
                success: true,
                data: result,
                strategy: strategy.name,
                metadata: { year, pageNumber, pageSize }
            };
            
        } catch (error) {
            console.log(`✗ Strategy "${strategy.name}" failed:`, error.message);
            lastError = error;
            continue;
        }
    }

    return {
        success: false,
        error: 'All fallback strategies failed',
        lastError: lastError?.message,
        metadata: { year, pageNumber, pageSize }
    };
}

module.exports = { fetchTenderDataWithFallback };