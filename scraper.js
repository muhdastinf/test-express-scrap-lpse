// scraper.js

// Impor kedua modul http dan https
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Fungsi ini secara dinamis memilih modul http atau https berdasarkan URL.
 * @param {string} urlString URL tujuan.
 * @returns {object} Modul http atau https.
 */
const getRequestModule = (urlString) => {
    return urlString.startsWith('https') ? https : http;
};

/**
 * Mengambil token dan cookie dari halaman utama.
 * @param {string} url URL halaman lelang.
 * @param {object} headers Headers untuk request.
 * @param {string|null} proxyUrl URL proxy opsional.
 * @returns {Promise<{token: string, cookie: string}>}
 */
function getTokenAndCookie(url, headers, proxyUrl = null) {
    return new Promise((resolve, reject) => {
        const options = { headers };
        if (proxyUrl) {
            options.agent = new HttpsProxyAgent(proxyUrl);
        }

        const requestModule = getRequestModule(url);

        const req = requestModule.get(url, options, (res) => {
            // Menangani redirect (kode 301, 302)
            if (res.statusCode === 301 || res.statusCode === 302) {
                console.log(`Redirect terdeteksi ke: ${res.headers.location}`);
                // Rekursif memanggil fungsi dengan URL baru dari header location
                return getTokenAndCookie(res.headers.location, headers, proxyUrl)
                    .then(resolve)
                    .catch(reject);
            }

            let html = '';
            const cookie = res.headers['set-cookie']?.join('; ') || '';
            
            res.on('data', (chunk) => {
                html += chunk;
            });

            res.on('end', () => {
                if (!html.includes('authenticityToken')) {
                    console.log("HTML diterima (token tidak ditemukan):", html.substring(0, 500) + "...");
                }

                const tokenRegex = /authenticityToken = '([a-f0-9]+)';/;
                const match = html.match(tokenRegex);
                
                if (match && match[1]) {
                    resolve({ token: match[1], cookie: cookie });
                } else {
                    reject(new Error('Gagal menemukan authenticityToken di halaman target. Mungkin struktur halaman telah berubah atau IP diblokir.'));
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Mengirim request POST untuk mendapatkan data tender.
 * @param {string} url URL untuk mengambil data.
 * @param {object} payload Data yang akan dikirim.
 * @param {object} headers Headers untuk request.
 * @param {string|null} proxyUrl URL proxy opsional.
 * @returns {Promise<object>}
 */
function postForTenderData(url, payload, headers, proxyUrl = null) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify(payload);
        const urlObject = new URL(url);

        const options = {
            hostname: urlObject.hostname,
            path: urlObject.pathname + urlObject.search,
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        if (proxyUrl) {
            options.agent = new HttpsProxyAgent(proxyUrl);
        }

        const requestModule = getRequestModule(url);

        const req = requestModule.request(options, (res) => {
            let jsonResponse = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                jsonResponse += chunk;
            });
            res.on('end', () => {
                try {
                    // Cek jika response kosong, yang bisa terjadi jika ada masalah
                    if (!jsonResponse) {
                        return reject(new Error('Menerima respons kosong dari server.'));
                    }
                    resolve(JSON.parse(jsonResponse));
                } catch (e) {
                    reject(new Error('Gagal mem-parsing respons JSON dari server: ' + e.message));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error('Request error: ' + e.message));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Fungsi utama untuk mengambil data tender berdasarkan parameter.
 * @param {number} year Tahun lelang.
 * @param {number} pageNumber Nomor halaman.
 * @param {number} pageSize Jumlah data per halaman.
 * @param {string|null} proxyUrl URL proxy opsional.
 * @returns {Promise<{success: boolean, data?: object, error?: string, metadata?: object}>}
 */
async function fetchTenderData(year, pageNumber = 1, pageSize = 10, proxyUrl = null) {
    // *** PERUBAHAN UTAMA: Gunakan http sebagai default ***
    const baseUrl = 'http://spse.inaproc.id/kemkes';
    const lelangPageUrl = `${baseUrl}/lelang`;
    // URL data tidak perlu diubah karena akan mengikuti baseUrl
    const dataUrl = `${baseUrl}/dt/lelang?tahun=${year}`;

    const commonHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    };

    try {
        const { token, cookie } = await getTokenAndCookie(lelangPageUrl, commonHeaders, proxyUrl);

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

        const headersForPost = {
            ...commonHeaders,
            'Cookie': cookie,
            'Referer': lelangPageUrl,
            'X-Requested-With': 'XMLHttpRequest'
        };

        const tenderData = await postForTenderData(dataUrl, payload, headersForPost, proxyUrl);

        return {
            success: true,
            data: tenderData,
            metadata: { year, pageNumber, pageSize }
        };

    } catch (error) {
        console.error("Kesalahan pada proses scraping:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = { fetchTenderData };
