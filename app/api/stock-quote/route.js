/**
 * GET /api/stock-quote?codes=2330:tw,005930:kr,4062.T:jp
 *
 * 获取台/韩/日/港股实时涨跌幅。
 * 台股：mis.twse.com.tw（台交所官方 API，实时）
 * 日/韩/港：Yahoo Finance v8 chart API
 * 日股兜底：stooq.com
 * 韩股兜底：Naver Finance
 */
const MARKET_SUFFIX = {
  tw: '.TW',
  kr: '.KS',
  jp: '.T',
  hk: '.HK',
};

/**
 * 单标的 Yahoo Finance 行情查询
 * @returns {{ change: number } | null}
 */
async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;

    const json = await resp.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null || meta.previousClose == null || meta.previousClose === 0) {
      return null;
    }

    const change = Math.round(((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 10000) / 100;
    return { change };
  } catch {
    return null;
  }
}

/**
 * 通过 HTTP 代理（Clash 7899 CONNECT 隧道）发送 HTTPS GET 请求
 * 用于访问台交所等无法直连的境外接口
 */
async function fetchViaHttpProxy(url, proxyPort = 7899) {
  const { request: httpReq } = await import('node:http');
  const { request: httpsReq } = await import('node:https');
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const connectReq = httpReq({
      hostname: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: urlObj.hostname + ':443',
      timeout: 10000,
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error('CONNECT ' + res.statusCode));
        return;
      }
      const tlsReq = httpsReq({
        host: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        socket,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }, (tlsRes) => {
        let body = '';
        tlsRes.on('data', (chunk) => body += chunk);
        tlsRes.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Parse failed')); }
        });
      });
      tlsReq.on('error', reject);
      tlsReq.end();
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}

/**
 * 台交所行情（台股主数据源，实时）
 * codes: ["tse_2330.tw", "tse_2454.tw"] → { "2330": { change }, "2454": { change } }
 * 注：台交所域名需走 Clash 代理（127.0.0.1:7899）
 */
async function fetchTwseQuotes(codes) {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=${codes.join('|')}`;
    const json = await fetchViaHttpProxy(url);
    const results = {};
    for (const item of json.msgArray || []) {
      const z = parseFloat(item.z);
      const y = parseFloat(item.y);
      if (!isNaN(z) && !isNaN(y) && y > 0) {
        results[item.c] = {
          change: Math.round(((z - y) / y) * 10000) / 100,
        };
      }
    }
    return results;
  } catch {
    return {};
  }
}

/**
 * Naver Finance 日线行情（韩股兜底）
 * codes: ["005930", "000660"] → { "005930": { change }, "000660": { change } }
 * 数据为最近交易日收盘价（非实时），本地开发兜底用
 */
async function fetchNaverKrQuotes(codes) {
  const results = {};
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const startDate = `${yyyy - 1}${mm}${dd}`; // 一年前，确保覆盖

  const promises = codes.map(async (code) => {
    try {
      const resp = await fetch(
        `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${startDate}&endTime=${yyyy}${mm}${dd}&timeframe=day`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) },
      );
      if (!resp.ok) return;

      const raw = await resp.text();
      const match = raw.match(/\[.*\]/s);
      if (!match) return;

      const cleaned = match[0].replace(/'/g, '"').replace(/[\n\t\r]+/g, '');
      const data = JSON.parse(cleaned);
      const rows = data.slice(1);
      if (rows.length < 2) return;

      const latestClose = rows[rows.length - 1][4];
      const prevClose = rows[rows.length - 2][4];
      if (latestClose && prevClose && prevClose > 0) {
        results[code] = {
          change: Math.round(((latestClose - prevClose) / prevClose) * 10000) / 100,
        };
      }
    } catch { /* 单只失败不影响其他 */ }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Stooq 批量行情（日股兜底）
 * codes: ["4062.JP", "7203.JP"] → { "4062.JP": { change }, "7203.JP": { change } }
 */
async function fetchStooqQuotes(codes) {
  try {
    const resp = await fetch(
      `https://stooq.com/q/l/?s=${codes.join('+')}&f=sd2t2ohlcvp&h&e=csv`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) },
    );
    if (!resp.ok) return {};

    const csv = await resp.text();
    const results = {};
    const lines = csv.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 9) continue;
      const symbol = parts[0]?.trim();
      const close = parseFloat(parts[6]);
      const prev = parseFloat(parts[8]);
      if (symbol && !isNaN(close) && !isNaN(prev) && prev > 0) {
        results[symbol] = {
          change: Math.round(((close - prev) / prev) * 10000) / 100,
        };
      }
    }
    return results;
  } catch {
    return {};
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const codesStr = searchParams.get('codes');

  if (!codesStr) {
    return Response.json({ error: 'codes parameter required' }, { status: 400 });
  }

  const items = codesStr.split(',').map(c => c.trim()).filter(Boolean);
  const results = {};
  for (const item of items) results[item] = { change: null };

  // 台股单独走台交所 TWSE（不走 Yahoo）
  const twItems = [];
  const itemToYahoo = {};
  const yahooToItems = {};
  for (const item of items) {
    const idx = item.lastIndexOf(':');
    if (idx === -1) continue;
    const code = item.substring(0, idx);
    const market = item.substring(idx + 1);
    const suffix = MARKET_SUFFIX[market];
    if (!suffix) continue;

    if (market === 'tw') {
      twItems.push(item);
      continue;
    }

    const yahooSymbol = market === 'jp' ? code : `${code}${suffix}`;
    itemToYahoo[item] = yahooSymbol;
    (yahooToItems[yahooSymbol] ??= []).push(item);
  }

  // 并行拉取 Yahoo Finance（日股/韩股/港股）
  const yahooSymbols = [...new Set(Object.values(itemToYahoo))];
  const yahooResults = await Promise.all(
    yahooSymbols.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) })),
  );

  const failedJpItems = [];
  const failedKrItems = [];
  for (const { symbol, data } of yahooResults) {
    for (const item of yahooToItems[symbol] || []) {
      if (data?.change != null) {
        results[item] = data;
      } else if (item.endsWith(':jp')) {
        failedJpItems.push(item);
      } else if (item.endsWith(':kr')) {
        failedKrItems.push(item);
      }
    }
  }

  // 日股兜底：stooq
  if (failedJpItems.length > 0) {
    const stooqCodes = failedJpItems.map(item => {
      const code = item.replace(':jp', '').replace('.T', '');
      return code + '.JP';
    });
    const stooqResults = await fetchStooqQuotes(stooqCodes);
    for (const item of failedJpItems) {
      const code = item.replace(':jp', '').replace('.T', '');
      const r = stooqResults[code + '.JP'];
      if (r) results[item] = r;
    }
  }


  // 台股：直接通过台交所 TWSE 获取（主数据源）
  if (twItems.length > 0) {
    const twseCodes = twItems.map(item => {
      const code = item.replace(':tw', '');
      return `tse_${code}.tw`;
    });
    const twseResults = await fetchTwseQuotes(twseCodes);
    for (const item of twItems) {
      const code = item.replace(':tw', '');
      const r = twseResults[code];
      if (r) results[item] = r;
    }
  }

  // 韩股兜底：Naver Finance（日线收盘价）
  if (failedKrItems.length > 0) {
    const krCodes = failedKrItems.map(item => item.replace(':kr', ''));
    const krResults = await fetchNaverKrQuotes(krCodes);
    for (const item of failedKrItems) {
      const code = item.replace(':kr', '');
      const r = krResults[code];
      if (r) results[item] = r;
    }
  }

  return Response.json({ success: true, data: results });
}
