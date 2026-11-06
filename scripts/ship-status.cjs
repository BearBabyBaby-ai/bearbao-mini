// 排程：讀各船公司網站停航公告 → www/ship_status.json（網頁版使用）
const fs = require('fs');
const path = require('path');
const https = require('https');
const S = require('../www/lib/ship-suspension.js');
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
// 部分船公司網站加密設定老舊：不用 DHE 金鑰交換（與手機瀏覽器相同）
const CIPHERS = 'ECDHE+AESGCM:ECDHE+CHACHA20:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA:@SECLEVEL=0';

function get(url, hops = 0) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': UA }, ciphers: CIPHERS, timeout: 20000 }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 4) {
                res.resume();
                return resolve(get(new URL(res.headers.location, url).href, hops + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(S.decodeHtml(Buffer.concat(chunks))));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

// 本機測試用（經代理時改用 curl）
function curlFetch(url) {
    const { execFileSync } = require('child_process');
    return Promise.resolve(S.decodeHtml(execFileSync('curl', ['-sS', '-L', '-m', '20', '-A', UA, '--ciphers', CIPHERS, '--fail', url])));
}

async function fetchText(url) {
    try { return await get(url); }
    catch (e) {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return S.decodeHtml(await res.arrayBuffer());
    }
}

const OUT = path.join(__dirname, '..', 'www', 'ship_status.json');

(async () => {
    const operators = await S.collect(process.env.CURL_FETCH ? curlFetch : fetchText);
    // 這次讀不到的船公司，沿用上次成功的公告期間（每日船班頁除外）
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')).operators || {}; } catch (e) { /* 無舊檔 */ }
    S.OPERATORS.forEach(op => {
        if (!operators[op.id].ok && !op.dayPage && prev[op.id] && prev[op.id].ok) operators[op.id] = prev[op.id];
    });
    const out = { updated: new Date().toISOString(), operators };
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(JSON.stringify(out));
})();
