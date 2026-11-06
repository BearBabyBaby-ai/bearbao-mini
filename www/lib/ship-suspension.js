// 船公司停航公告解析（網頁版、APP、GitHub 排程共用）
(function (root) {
    const OPERATORS = [
        { id: 'taiji', ships: ['1', '2', '10'], urls: ['https://www.taijistar.com.tw/news.php', 'https://www.taijistar.com.tw/'] },
        { id: 'pescadores', ships: ['3', '4', '5'], urls: ['https://www.pescadoresferry.com.tw/shipList', 'https://www.pescadoresferry.com.tw/'] },
        { id: 'farnlin', ships: ['6', '9'], dayPage: true, urls: [d => `https://www.farnlin.com.tw/calendar_main_routestand.html?routestand=27&date=${d}`] },
        { id: 'allstar', ships: ['7', '8'], urls: ['https://www.aaaaa.com.tw/'], follow: /停航|開航|復航|停、開航/ }
    ];

    const pad = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const toDate = s => new Date(`${s}T00:00:00Z`);
    const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
    const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

    function taipeiToday() { return ymd(new Date(Date.now() + 8 * 3600 * 1000)); }

    function htmlToText(html) {
        return String(html)
            .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/(p|div|li|h\d|tr)>/gi, '。')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ');
    }

    // 解碼網頁（依 meta charset 判斷 UTF-8／Big5）
    function decodeHtml(buf) {
        const bytes = new Uint8Array(buf);
        const head = new TextDecoder('latin1').decode(bytes.slice(0, 3000));
        const m = head.match(/charset\s*=\s*["']?\s*([\w-]+)/i);
        const cs = m ? m[1].toLowerCase() : 'utf-8';
        if (/big5|x-x-big5|cp950/.test(cs)) return new TextDecoder('big5').decode(bytes);
        // 標示 UTF-8 但實際是 Big5 的網站：亂碼比例高就改用 Big5
        const u = new TextDecoder('utf-8').decode(bytes);
        const bad = (u.match(/\uFFFD/g) || []).length;
        if (bad > 20 && bad > u.length * 0.01) return new TextDecoder('big5').decode(bytes);
        return u;
    }

    // 找出一段文字中的日期（依出現順序）
    const DATE_RE = /(?:(20\d{2})\s*[-\/]\s*(\d{1,2})\s*[-\/]\s*(\d{1,2}))|(?:(1\d{2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2}))|(?:(?:(20\d{2}|1\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(?:(\d{1,2})\s*[日號]?)?\s*(上旬|中旬|下旬|初|中|底)?)|(?:(\d{1,2})\s*\/\s*(\d{1,2}))/g;

    function resolveYear(m, d, ref) {
        const refD = toDate(ref);
        let y = refD.getUTCFullYear();
        const cand = Date.UTC(y, m - 1, d);
        if (cand < refD.getTime() - 90 * 864e5) y += 1;
        else if (cand > refD.getTime() + 300 * 864e5) y -= 1;
        return y;
    }

    function findDates(text, ref) {
        const out = [];
        DATE_RE.lastIndex = 0;
        let m;
        while ((m = DATE_RE.exec(text))) {
            let y = null, mo, d, part = null;
            if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; }
            else if (m[4]) { y = +m[4] + 1911; mo = +m[5]; d = +m[6]; }
            else if (m[8]) { y = m[7] ? (+m[7] < 1000 ? +m[7] + 1911 : +m[7]) : null; mo = +m[8]; d = m[9] ? +m[9] : null; part = m[10] || null; }
            else if (m[11]) { mo = +m[11]; d = +m[12]; }
            if (!mo || mo < 1 || mo > 12 || (d !== null && (d < 1 || d > 31))) continue;
            out.push({ y, mo, d, part, index: m.index, end: m.index + m[0].length });
        }
        return out;
    }

    // 日期轉 YYYY-MM-DD；isEnd 時「3月」「3月底」取月底、「3月中」取 15 日
    function dateStr(t, ref, isEnd) {
        let d = t.d;
        if (d === null) {
            const y0 = t.y || resolveYear(t.mo, 1, ref);
            if (t.part === '初' || t.part === '上旬') d = isEnd ? 10 : 1;
            else if (t.part === '中' || t.part === '中旬') d = isEnd ? 20 : 11;
            else d = isEnd ? lastDay(y0, t.mo) : (t.part === '底' || t.part === '下旬' ? 21 : 1);
        }
        const y = t.y || resolveYear(t.mo, d, ref);
        return `${y}-${pad(t.mo)}-${pad(Math.min(d, lastDay(y, t.mo)))}`;
    }

    const STOP_RE = /停航|停駛|停班|無船班|暫停客運|暫停航行|暫停營運/;
    const RESUME_RE = /復航|恢復通航|恢復航行|恢復營運|恢復行駛|恢復正常|開航/;

    // 解析公告文字 → 停航期間
    function parseNotices(text, today) {
        const periods = [];
        // 依公告發布日期（YYYY-MM-DD）切段，段內以發布日當基準年
        const parts = text.split(/(?=20\d{2}-\d{2}-\d{2})/);
        for (const part of parts) {
            const pub = part.match(/^(20\d{2}-\d{2}-\d{2})/);
            const ref = pub ? pub[1] : today;
            const body = (pub ? part.slice(pub[0].length) : part).replace(/公告\s*[（(][^（）()]{4,12}[）)]/g, '公告');
            const clauses = body.split(/[。！!？?★●◎]|，(?=[^，]{0,4}(?:並|將|預計|另|如|若|造成|敬請))/);
            for (let i = 0; i < clauses.length; i++) {
                const c = clauses[i];
                if (!STOP_RE.test(c)) continue;
                const ds = findDates(c, ref);
                if (!ds.length) continue;
                const between = ds.length > 1 ? c.slice(ds[0].end, ds[1].index) : '';
                if (ds.length > 1 && /^\s*(?:日)?\s*(?:至|到|~|～|〜|－|-|—)\s*$/.test(between)) {
                    const start = dateStr(ds[0], ref, false);
                    let end = dateStr({ ...ds[1], y: ds[1].y }, start, true);
                    if (end < start) end = dateStr({ ...ds[1], y: (ds[1].y || +start.slice(0, 4)) + 1 }, start, true);
                    periods.push({ start, end });
                    continue;
                }
                const after = c.slice(ds[0].end, ds[0].end + 6);
                if (/起/.test(after)) {
                    const start = dateStr(ds[0], ref, false);
                    let end = addDays(start, 200);
                    // 同句或後幾句的「恢復／復航」日期當結束
                    const rest = [c.slice(ds[0].end), ...clauses.slice(i + 1, i + 4)].join('，');
                    const rIdx = rest.search(RESUME_RE);
                    if (rIdx >= 0) {
                        const rd = findDates(rest.slice(Math.max(0, rIdx - 30), rIdx + 30), start);
                        if (rd.length) { const r = dateStr(rd[0], start, true); if (r > start) end = r; }
                    }
                    periods.push({ start, end });
                    continue;
                }
                // 單日停航（例：10/07(三) 全天停航）
                ds.forEach(t => { if (t.d !== null) { const s = dateStr(t, ref, false); periods.push({ start: s, end: s }); } });
            }
            // 復航公告：該日起不再停航
            clauses.forEach(c => {
                if (!RESUME_RE.test(c) || STOP_RE.test(c) || /預計|將另行|另行公告/.test(c)) return;
                findDates(c, ref).forEach(t => {
                    if (t.d === null) return;
                    const r = dateStr(t, ref, false);
                    periods.forEach(p => { if (r > p.start && r <= p.end) p.end = addDays(r, -1); });
                });
            });
        }
        return periods;
    }

    // 首頁上的停／開航公告連結
    function noticeLinks(op, html, baseUrl) {
        if (!op.follow) return [];
        const links = [];
        const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = re.exec(html))) {
            if (!op.follow.test(htmlToText(m[2]))) continue;
            try { const u = new URL(m[1], baseUrl).href; if (!links.includes(u)) links.push(u); } catch (e) { /* 略過 */ }
        }
        return links.slice(0, 3);
    }

    function parseOperator(op, html, today) {
        const text = htmlToText(html);
        if (op.dayPage) return /無船班/.test(text) ? [{ start: today, end: today }] : [];
        return parseNotices(text, today);
    }

    // fetchText(url) → Promise<string>
    async function collect(fetchText, today) {
        today = today || taipeiToday();
        const result = {};
        await Promise.all(OPERATORS.map(async op => {
            const periods = [];
            let ok = false;
            for (const u of op.urls) {
                const url = typeof u === 'function' ? u(today) : u;
                try {
                    const html = await fetchText(url);
                    periods.push(...parseOperator(op, html, today)); ok = true;
                    for (const link of noticeLinks(op, html, url)) {
                        try { periods.push(...parseOperator(op, await fetchText(link), today)); } catch (e) { /* 略過 */ }
                    }
                } catch (e) { /* 下一個網址 */ }
            }
            result[op.id] = { ok, periods, checkedDate: today };
        }));
        return result;
    }

    // 依結果算出今天停航的船（No. 清單）
    function suspendedShips(result, today) {
        today = today || taipeiToday();
        const set = new Set();
        OPERATORS.forEach(op => {
            const r = result && result[op.id];
            if (!r || !r.ok) return;
            if (op.dayPage && r.checkedDate !== today) return;
            if (r.periods.some(p => p.start <= today && today <= p.end)) op.ships.forEach(n => set.add(n));
        });
        return set;
    }

    const api = { OPERATORS, taipeiToday, htmlToText, decodeHtml, parseNotices, parseOperator, noticeLinks, collect, suspendedShips };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.BearSuspension = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
