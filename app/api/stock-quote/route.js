/**
 * GET /api/stock-quote?codes=2330:tw,005930:kr,4062.T:jp
 *
 * 获取台/韩/日/港股实时涨跌幅。
 * 主数据源：Yahoo Finance v8 chart API（免费、无需 Key、服务端无 CORS）
 * 日股兜底：stooq.com（Yahoo 日股个别标的可能缺数据）
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
 * Stooq 批量行情（日股兜底）
 * codes: ["4062.JP", "7203.JP"] → { "4062.JP": { change }, "7203.JP": { change } }
 */
async function fetchStooqQuotes(codes) {
  try {
    const resp = await fetch(
      `https://stooq.com/q/l/?s=${codes.join(',')}&f=sd2t2ohlcvp&h&e=csv`,
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

  // 解析 code:market → Yahoo Finance 符号
  //   "2330:tw" → "2330.TW"   "005930:kr" → "005930.KS"   "4062.T:jp" → "4062.T"
  const itemToYahoo = {};
  const yahooToItems = {};
  for (const item of items) {
    const idx = item.lastIndexOf(':');
    if (idx === -1) continue;
    const code = item.substring(0, idx);
    const market = item.substring(idx + 1);
    const suffix = MARKET_SUFFIX[market];
    if (!suffix) continue;

    const yahooSymbol = market === 'jp' ? code : `${code}${suffix}`;
    itemToYahoo[item] = yahooSymbol;
    (yahooToItems[yahooSymbol] ??= []).push(item);
  }

  // 并行拉取 Yahoo Finance
  const yahooSymbols = [...new Set(Object.values(itemToYahoo))];
  const yahooResults = await Promise.all(
    yahooSymbols.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) })),
  );

  const failedJpItems = [];
  for (const { symbol, data } of yahooResults) {
    for (const item of yahooToItems[symbol] || []) {
      if (data?.change != null) {
        results[item] = data;
      } else if (item.endsWith(':jp')) {
        failedJpItems.push(item);
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

  return Response.json({ success: true, data: results });
}
