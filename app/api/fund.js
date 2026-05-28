import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Shanghai');

const TZ = 'Asia/Shanghai';
const nowInTz = () => dayjs().tz(TZ);
const toTz = (input) => (input ? dayjs.tz(input, TZ) : nowInTz());

export const loadScript = (url) => {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || !document.body) return resolve();
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    const cleanup = () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
    script.onload = () => {
      cleanup();
      resolve();
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('数据加载失败'));
    };
    document.body.appendChild(script);
  });
};

export const fetchFundNetValue = async (code, date) => {
  if (typeof window === 'undefined') return null;
  const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${code}&page=1&per=1&sdate=${date}&edate=${date}`;
  try {
    await loadScript(url);
    if (window.apidata && window.apidata.content) {
      const content = window.apidata.content;
      if (content.includes('暂无数据')) return null;
      const rows = content.split('<tr>');
      for (const row of rows) {
        if (row.includes(`<td>${date}</td>`)) {
          const cells = row.match(/<td[^>]*>(.*?)<\/td>/g);
          if (cells && cells.length >= 2) {
            const valStr = cells[1].replace(/<[^>]+>/g, '');
            const val = parseFloat(valStr);
            return isNaN(val) ? null : val;
          }
        }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
};

export const fetchSmartFundNetValue = async (code, startDate) => {
  const today = nowInTz().startOf('day');
  let current = toTz(startDate).startOf('day');
  for (let i = 0; i < 30; i++) {
    if (current.isAfter(today)) break;
    const dateStr = current.format('YYYY-MM-DD');
    const val = await fetchFundNetValue(code, dateStr);
    if (val !== null) {
      return { date: dateStr, value: val };
    }
    current = current.add(1, 'day');
  }
  return null;
};

export const fetchFundDataFallback = async (c) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('无浏览器环境');
  }
  return new Promise(async (resolve, reject) => {
    const searchCallbackName = `SuggestData_fallback_${Date.now()}`;
    const searchUrl = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(c)}&callback=${searchCallbackName}&_=${Date.now()}`;
    let fundName = '';
    try {
      await new Promise((resSearch, rejSearch) => {
        window[searchCallbackName] = (data) => {
          if (data && data.Datas && data.Datas.length > 0) {
            const found = data.Datas.find(d => d.CODE === c);
            if (found) {
              fundName = found.NAME || found.SHORTNAME || '';
            }
          }
          delete window[searchCallbackName];
          resSearch();
        };
        const script = document.createElement('script');
        script.src = searchUrl;
        script.async = true;
        script.onload = () => {
          if (document.body.contains(script)) document.body.removeChild(script);
        };
        script.onerror = () => {
          if (document.body.contains(script)) document.body.removeChild(script);
          delete window[searchCallbackName];
          rejSearch(new Error('搜索接口失败'));
        };
        document.body.appendChild(script);
        setTimeout(() => {
          if (window[searchCallbackName]) {
            delete window[searchCallbackName];
            resSearch();
          }
        }, 3000);
      });
    } catch (e) {
    }
    const tUrl = `https://qt.gtimg.cn/q=jj${c}`;
    const tScript = document.createElement('script');
    tScript.src = tUrl;
    tScript.onload = () => {
      const v = window[`v_jj${c}`];
      if (v && v.length > 5) {
        const p = v.split('~');
        const name = fundName || p[1] || `未知基金(${c})`;
        const dwjz = p[5];
        const zzl = parseFloat(p[7]);
        const jzrq = p[8] ? p[8].slice(0, 10) : '';
        if (dwjz) {
          resolve({
            code: c,
            name: name,
            dwjz: dwjz,
            gsz: null,
            gztime: null,
            jzrq: jzrq,
            gszzl: null,
            zzl: !isNaN(zzl) ? zzl : null,
            noValuation: true,
            holdings: []
          });
        } else {
          reject(new Error('未能获取到基金数据'));
        }
      } else {
        reject(new Error('未能获取到基金数据'));
      }
      if (document.body.contains(tScript)) document.body.removeChild(tScript);
    };
    tScript.onerror = () => {
      if (document.body.contains(tScript)) document.body.removeChild(tScript);
      reject(new Error('基金数据加载失败'));
    };
    document.body.appendChild(tScript);
  });
};

export const fetchFundData = async (c) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('无浏览器环境');
  }
  return new Promise(async (resolve, reject) => {
    const gzUrl = `https://fundgz.1234567.com.cn/js/${c}.js?rt=${Date.now()}`;
    const scriptGz = document.createElement('script');
    scriptGz.src = gzUrl;
    const originalJsonpgz = window.jsonpgz;
    window.jsonpgz = (json) => {
      window.jsonpgz = originalJsonpgz;
      if (!json || typeof json !== 'object') {
        fetchFundDataFallback(c).then(resolve).catch(reject);
        return;
      }
      const gszzlNum = Number(json.gszzl);
      const gzData = {
        code: json.fundcode,
        name: json.name,
        dwjz: json.dwjz,
        gsz: json.gsz,
        gztime: json.gztime,
        jzrq: json.jzrq,
        gszzl: Number.isFinite(gszzlNum) ? gszzlNum : json.gszzl
      };
      const tencentPromise = new Promise((resolveT) => {
        const tUrl = `https://qt.gtimg.cn/q=jj${c}`;
        const tScript = document.createElement('script');
        tScript.src = tUrl;
        tScript.onload = () => {
          const v = window[`v_jj${c}`];
          if (v) {
            const p = v.split('~');
            resolveT({
              dwjz: p[5],
              zzl: parseFloat(p[7]),
              jzrq: p[8] ? p[8].slice(0, 10) : ''
            });
          } else {
            resolveT(null);
          }
          if (document.body.contains(tScript)) document.body.removeChild(tScript);
        };
        tScript.onerror = () => {
          if (document.body.contains(tScript)) document.body.removeChild(tScript);
          resolveT(null);
        };
        document.body.appendChild(tScript);
      });
      const holdingsPromise = new Promise((resolveH) => {
        const holdingsUrl = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${c}&topline=10&year=&month=&_=${Date.now()}`;
        loadScript(holdingsUrl).then(async () => {
          let holdings = [];
          const html = window.apidata?.content || '';
          const headerRow = (html.match(/<thead[\s\S]*?<tr[\s\S]*?<\/tr>[\s\S]*?<\/thead>/i) || [])[0] || '';
          const headerCells = (headerRow.match(/<th[\s\S]*?>([\s\S]*?)<\/th>/gi) || []).map(th => th.replace(/<[^>]*>/g, '').trim());
          let idxCode = -1, idxName = -1, idxWeight = -1;
          headerCells.forEach((h, i) => {
            const t = h.replace(/\s+/g, '');
            if (idxCode < 0 && (t.includes('股票代码') || t.includes('证券代码'))) idxCode = i;
            if (idxName < 0 && (t.includes('股票名称') || t.includes('证券名称'))) idxName = i;
            if (idxWeight < 0 && (t.includes('占净值比例') || t.includes('占比'))) idxWeight = i;
          });
          const rows = html.match(/<tbody[\s\S]*?<\/tbody>/i) || [];
          const dataRows = rows.length ? rows[0].match(/<tr[\s\S]*?<\/tr>/gi) || [] : html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
          for (const r of dataRows) {
            const tds = (r.match(/<td[\s\S]*?>([\s\S]*?)<\/td>/gi) || []).map(td => td.replace(/<[^>]*>/g, '').trim());
            if (!tds.length) continue;
            let code = '';
            let name = '';
            let weight = '';
            if (idxCode >= 0 && tds[idxCode]) {
              const m = tds[idxCode].match(/(\d{6})/);
              code = m ? m[1] : tds[idxCode];
            } else {
              const codeIdx = tds.findIndex(txt => /^\d{6}$/.test(txt));
              if (codeIdx >= 0) code = tds[codeIdx];
            }
            if (idxName >= 0 && tds[idxName]) {
              name = tds[idxName];
            } else if (code) {
              const i = tds.findIndex(txt => txt && txt !== code && !/%$/.test(txt));
              name = i >= 0 ? tds[i] : '';
            }
            if (idxWeight >= 0 && tds[idxWeight]) {
              const wm = tds[idxWeight].match(/([\d.]+)\s*%/);
              weight = wm ? `${wm[1]}%` : tds[idxWeight];
            } else {
              const wIdx = tds.findIndex(txt => /\d+(?:\.\d+)?\s*%/.test(txt));
              weight = wIdx >= 0 ? tds[wIdx].match(/([\d.]+)\s*%/)?.[1] + '%' : '';
            }
            if (code || name || weight) {
              holdings.push({ code, name, weight, change: null });
            }
          }
          // ===== 附加持仓市场元信息：从东方财富原始HTML中识别境外股 =====
          holdings = holdings.slice(0, 10);
          try {
            const dataRowsHtml = (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).slice(1, 11);
            dataRowsHtml.forEach((rowHtml, idx) => {
              if (idx >= holdings.length) return;
              const tds = (rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []);
              if (tds.length < 2) return;
              const codeTd = tds[1];
              // 1) 检查 unify href（港股/美股）
              const unifyMatch = codeTd.match(/unify\/r\/(\d+)\.([\w.]+)/);
              if (unifyMatch) {
                const marketId = unifyMatch[1];
                const sym = unifyMatch[2];
                if (marketId === '116') {
                  holdings[idx]._market = 'hk';
                  holdings[idx]._stockCode = sym;
                } else if (marketId === '106' || marketId === '105') {
                  holdings[idx]._market = 'us';
                  holdings[idx]._stockCode = sym;
                }
                return;
              }
              // 2) 检查 data-texch 为空的纯数字代码
              const spanMatch = codeTd.match(/<span[^>]+data-texch=['"](.*?)['"][^>]*>([^<]+)<\/span>/);
              if (spanMatch) {
                const rawCode = spanMatch[2].trim();
                // data-texch 为空 → 非A股（东财A股会填交易所）
                // 台股：4-5位纯数字
                if (/^\d{4,5}$/.test(rawCode)) {
                  holdings[idx]._market = 'tw';
                  holdings[idx]._stockCode = rawCode;
                }
                // 韩股：6位数字以00/09开头
                if (/^\d{6}$/.test(rawCode) && (rawCode.startsWith('00') || rawCode.startsWith('09'))) {
                  holdings[idx]._market = 'kr';
                  holdings[idx]._stockCode = rawCode;
                }
                // 日股：XXXXJP格式
                if (/^\d{4}JP$/.test(rawCode)) {
                  holdings[idx]._market = 'jp';
                  holdings[idx]._stockCode = rawCode.replace('JP', '.T');
                }
              }
            });
          } catch (e) {
            // 市场识别失败，不影响核心数据
          }

          // ===== 获取重仓股行情 =====
          const needQuotes = holdings.filter(h => /^\d{6}$/.test(h.code) || /^\d{5}$/.test(h.code) || h._market);
          if (needQuotes.length) {
            try {
              // 构建腾讯行情代码列表
              const tencentCodes = needQuotes.map(h => {
                if (h._market === 'hk') return `s_hk${h._stockCode || h.code}`;
                if (h._market === 'us') return `us${h._stockCode || h.code}`;
                if (h._market === 'tw' || h._market === 'kr' || h._market === 'jp') return null;
                const cd = String(h.code || '');
                if (/^\d{6}$/.test(cd)) {
                  const pfx = cd.startsWith('6') || cd.startsWith('9') ? 'sh' : ((cd.startsWith('4') || cd.startsWith('8')) ? 'bj' : 'sz');
                  return `s_${pfx}${cd}`;
                }
                if (/^\d{5}$/.test(cd)) {
                  return `s_hk${cd}`;
                }
                return null;
              }).filter(Boolean).join(',');

              const quotePromises = [];

              // 1) 腾讯行情拉取（A股/港股/美股）
              if (tencentCodes) {
                quotePromises.push(new Promise((resQuote) => {
                  const scriptQuote = document.createElement('script');
                  scriptQuote.src = `https://qt.gtimg.cn/q=${tencentCodes}`;
                  scriptQuote.onload = () => {
                    needQuotes.forEach(h => {
                      let varName = '';
                      if (h._market === 'hk') {
                        varName = `v_s_hk${h._stockCode || h.code}`;
                      } else if (h._market === 'us') {
                        varName = `v_us${h._stockCode || h.code}`;
                      } else {
                        const cd = String(h.code || '');
                        if (/^\d{6}$/.test(cd)) {
                          const pfx = cd.startsWith('6') || cd.startsWith('9') ? 'sh' : ((cd.startsWith('4') || cd.startsWith('8')) ? 'bj' : 'sz');
                          varName = `v_s_${pfx}${cd}`;
                        } else if (/^\d{5}$/.test(cd)) {
                          varName = `v_s_hk${cd}`;
                        } else {
                          return;
                        }
                      }
                      if (!varName) return;
                      const dataStr = window[varName];
                      if (dataStr) {
                        const parts = dataStr.split('~');
                        if (h._market === 'us' && parts.length > 32) {
                          // 美股：涨跌幅在 parts[32]（parts[5] 是开盘价）
                          h.change = parseFloat(parts[32]);
                        } else if (parts.length > 30) {
                          // A股: 涨跌幅在第31个字段；港股类似
                          const changePct = parseFloat(parts[5]);
                          if (!isNaN(changePct)) {
                            h.change = changePct;
                          }
                        } else if (parts.length > 5) {
                          const changePct = parseFloat(parts[5]);
                          if (!isNaN(changePct)) {
                            h.change = changePct;
                          }
                        }
                      }
                    });
                    if (document.body.contains(scriptQuote)) document.body.removeChild(scriptQuote);
                    resQuote();
                  };
                  scriptQuote.onerror = () => {
                    if (document.body.contains(scriptQuote)) document.body.removeChild(scriptQuote);
                    resQuote();
                  };
                  document.body.appendChild(scriptQuote);
                }));
              }

              // 2) 境外台/韩/日股 → 通过 API Route 代理获取行情涨跌幅（新浪接口）
              const crossBorder = needQuotes.filter(h => h._market === 'tw' || h._market === 'kr' || h._market === 'jp');
              if (crossBorder.length > 0) {
                quotePromises.push((async () => {
                  try {
                    const toQuoteKey = (h) => {
                      const raw = h._stockCode || h.code;
                      return `${raw}:${h._market}`;
                    };
                    const codes = crossBorder.map(toQuoteKey).join(',');
                    const resp = await fetch(`/api/stock-quote?codes=${encodeURIComponent(codes)}`);
                    if (resp.ok) {
                      const json = await resp.json();
                      if (json.success && json.data) {
                        crossBorder.forEach(h => {
                          const key = toQuoteKey(h);
                          const result = json.data[key];
                          h.change = (result && typeof result.change === 'number') ? result.change : null;
                        });
                        return;
                      }
                    }
                  } catch (e) { /* 代理请求失败 */ }
                  crossBorder.forEach(h => { h.change = null; });
                })());
              }

              await Promise.all(quotePromises);
            } catch (e) {
              // 行情拉取失败
            }
          }
          resolveH(holdings);
        }).catch(() => resolveH([]));
      });

      const trendPromise = new Promise(async (resolveTr) => {
        try {
          const pingUrl = `https://fund.eastmoney.com/pingzhongdata/${c}.js?v=${Date.now()}`;
          await loadScript(pingUrl);

          // Data_netWorthTrend 为 [{ x, y, equityReturn, unitMoney }, ...]
          const trend = Array.isArray(window.Data_netWorthTrend)
            ? window.Data_netWorthTrend
            : [];
          
          let historyTrend = [];
          let yesterdayChange = null;

          if (trend.length > 0) {
            // 仅保留最近 90 个点
            const sliced = trend.slice(-90);
            historyTrend = sliced.map((item) => ({
              x: item.x,
              y: item.y,
              equityReturn: item.equityReturn,
            }));

            const last = sliced[sliced.length - 2];
            if (last && typeof last.equityReturn === 'number') {
              yesterdayChange = last.equityReturn;
            }
          }
          resolveTr({ historyTrend, yesterdayChange });
        } catch (e) {
          resolveTr({ historyTrend: [], yesterdayChange: null });
        }
      });

      Promise.all([tencentPromise, holdingsPromise, trendPromise]).then(([tData, holdings, trendData]) => {
        if (tData) {
          if (tData.jzrq && (!gzData.jzrq || tData.jzrq >= gzData.jzrq)) {
            gzData.dwjz = tData.dwjz;
            gzData.jzrq = tData.jzrq;
            gzData.zzl = tData.zzl;
          }
        }
        const { historyTrend, yesterdayChange } = trendData || {};

        // ===== 基于持仓行情自估算净值涨跌幅 =====
        if (Array.isArray(holdings) && holdings.length > 0) {
          let weightedSum = 0;
          let weightTotal = 0;
          for (const h of holdings) {
            const w = parseFloat(h.weight);
            const chg = parseFloat(h.change);
            if (!isNaN(w) && w > 0 && !isNaN(chg)) {
              weightedSum += w * chg;
              weightTotal += w;
            }
          }
          if (weightTotal > 0) {
            const estGszzl = Math.round(weightedSum / weightTotal * 100) / 100;
            const estPricedCoverage = Math.round(weightTotal) / 100;
            const dwjzNum = parseFloat(gzData.dwjz);
            if (!isNaN(dwjzNum) && dwjzNum > 0) {
              gzData.estGszzl = estGszzl;
              gzData.estPricedCoverage = estPricedCoverage;
              gzData.estGsz = Math.round(dwjzNum * (1 + estGszzl / 100) * 10000) / 10000;
            }
          }
        }

        resolve({ ...gzData, holdings, historyTrend, yesterdayChange });
      });
    };
    scriptGz.onerror = () => {
      window.jsonpgz = originalJsonpgz;
      if (document.body.contains(scriptGz)) document.body.removeChild(scriptGz);
      reject(new Error('基金数据加载失败'));
    };
    document.body.appendChild(scriptGz);
    setTimeout(() => {
      if (document.body.contains(scriptGz)) document.body.removeChild(scriptGz);
    }, 5000);
  });
};

export const searchFunds = async (val) => {
  if (!val.trim()) return [];
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];
  const callbackName = `SuggestData_${Date.now()}`;
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(val)}&callback=${callbackName}&_=${Date.now()}`;
  return new Promise((resolve, reject) => {
    window[callbackName] = (data) => {
      let results = [];
      if (data && data.Datas) {
        results = data.Datas.filter(d =>
          d.CATEGORY === 700 ||
          d.CATEGORY === '700' ||
          d.CATEGORYDESC === '基金'
        );
      }
      delete window[callbackName];
      resolve(results);
    };
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (document.body.contains(script)) document.body.removeChild(script);
    };
    script.onerror = () => {
      if (document.body.contains(script)) document.body.removeChild(script);
      delete window[callbackName];
      reject(new Error('搜索请求失败'));
    };
    document.body.appendChild(script);
  });
};

export const fetchShanghaiIndexDate = async () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://qt.gtimg.cn/q=sh000001&_t=${Date.now()}`;
    script.onload = () => {
      const data = window.v_sh000001;
      let dateStr = null;
      if (data) {
        const parts = data.split('~');
        if (parts.length > 30) {
          dateStr = parts[30].slice(0, 8);
        }
      }
      if (document.body.contains(script)) document.body.removeChild(script);
      resolve(dateStr);
    };
    script.onerror = () => {
      if (document.body.contains(script)) document.body.removeChild(script);
      reject(new Error('指数数据加载失败'));
    };
    document.body.appendChild(script);
  });
};

export const fetchLatestRelease = async () => {
  // 暂时禁用版本检查，避免控制台 404 报错
  return null;
  /*
  try {
    const res = await fetch('https://api.github.com/repos/zhengshengning/fund-baby/releases/latest');
    if (!res.ok) return null;
    const data = await res.json();
    return {
      tagName: data.tag_name,
      body: data.body || ''
    };
  } catch (e) {
    return null;
  }
  */
};

export const submitFeedback = async (formData) => {
  const response = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    body: formData
  });
  return response.json();
};

export const fetchIntradayData = async (code) => {
    try {
        // 使用腾讯财经接口，支持 CORS，无需后端代理
        const url = `https://web.ifzq.gtimg.cn/fund/newfund/fundSsgz/getSsgz?app=web&symbol=jj${code}&_=${Date.now()}`;
        const response = await fetch(url);
        if (!response.ok) return null;

        const result = await response.json();
        if (result.code === 0 && result.data && Array.isArray(result.data.data)) {
            const { data: list, yesterdayDwjz } = result.data;
            const yDwjz = parseFloat(yesterdayDwjz);

            if (!yDwjz) return null;

            return list.map(item => {
                // item: ["0930", 1.1846, -0.0036] (时间, 估值, 涨跌额)
                const timeStr = item[0];
                const value = Number(item[1]);

                // 格式化时间 "0930" -> "09:30"
                const formattedTime = `${timeStr.slice(0, 2)}:${timeStr.slice(2)}`;

                // 计算涨跌幅
                const growth = ((value - yDwjz) / yDwjz * 100).toFixed(2);

                return {
                    time: formattedTime,
                    value: value,
                    growth: growth
                };
            });
        }
        return null;
    } catch (e) {
        console.error('获取分时数据失败', code, e);
        return null;
    }
};
