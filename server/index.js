const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const iconv = require('iconv-lite');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Gmail 인증 시스템 ────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ALLOWED_EMAILS = ['jykim94@gmail.com'];
const pendingCodes = new Map();

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '유효한 이메일을 입력해주세요.' });
    }
    if (!ALLOWED_EMAILS.includes(email.toLowerCase())) {
      return res.status(403).json({ error: '접근이 허용되지 않은 이메일입니다.' });
    }
    const existing = pendingCodes.get(email);
    if (existing && existing.expiresAt - Date.now() > 4 * 60 * 1000) {
      return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    pendingCodes.set(email, { code, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"InsightLedger AI" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: '[InsightLedger AI] 로그인 인증코드',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f5f5f9;border-radius:12px;">
          <h2 style="color:#7c3aed;margin:0 0 8px;">InsightLedger AI</h2>
          <p style="color:#6b7280;margin:0 0 24px;">로그인 인증코드입니다.</p>
          <div style="background:#fff;border-radius:8px;padding:24px;text-align:center;border:1px solid #e4e4ec;">
            <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1e1e2f;margin:0;">${code}</p>
          </div>
          <p style="color:#6b7280;font-size:13px;margin:16px 0 0;">이 코드는 5분간 유효합니다.</p>
        </div>
      `,
    });
    console.log(`[Auth] 인증코드 발송: ${email}`);
    res.json({ success: true, message: '인증코드가 발송되었습니다.' });
  } catch (e) {
    console.error('[Auth] 이메일 발송 실패:', e.message);
    res.status(500).json({ error: '이메일 발송에 실패했습니다. Gmail 설정을 확인해주세요.' });
  }
});

app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: '이메일과 인증코드를 입력해주세요.' });
  const pending = pendingCodes.get(email);
  if (!pending) return res.status(400).json({ error: '인증코드를 먼저 요청해주세요.' });
  if (Date.now() > pending.expiresAt) {
    pendingCodes.delete(email);
    return res.status(400).json({ error: '인증코드가 만료되었습니다.' });
  }
  pending.attempts += 1;
  if (pending.attempts > 5) {
    pendingCodes.delete(email);
    return res.status(429).json({ error: '시도 횟수 초과. 새 코드를 요청해주세요.' });
  }
  if (pending.code !== String(code).trim()) {
    return res.status(400).json({ error: `인증코드 불일치 (${5 - pending.attempts}회 남음)` });
  }
  pendingCodes.delete(email);
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  console.log(`[Auth] 로그인 성공: ${email}`);
  res.json({ success: true, token, email });
});

app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: '인증 필요' });
  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    res.json({ email: decoded.email });
  } catch {
    res.status(401).json({ error: '토큰 만료' });
  }
});

// 인증 미들웨어 — 이후 모든 /api/* 보호
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: '인증 만료. 다시 로그인해주세요.' });
  }
});

// ─── Groq API 큐 + 재시도 ─────────────────────────────────────────────────────
let groqQueue = Promise.resolve();
let lastGroqCall = 0;
const GROQ_MIN_INTERVAL = 1500; // 요청 간 최소 간격 (ms)

function callGroq(body, maxRetries = 4) {
  // 직렬 큐를 통해 동시 요청 방지 + 최소 간격 보장
  groqQueue = groqQueue.catch(() => {}).then(async () => {
    const elapsed = Date.now() - lastGroqCall;
    if (elapsed < GROQ_MIN_INTERVAL) {
      await new Promise(r => setTimeout(r, GROQ_MIN_INTERVAL - elapsed));
    }
    const result = await _callGroqWithRetry(body, maxRetries);
    lastGroqCall = Date.now();
    return result;
  });
  return groqQueue;
}

async function _callGroqWithRetry(body, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        body,
        { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      return response;
    } catch (e) {
      const status = e.response?.status;
      if (status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(e.response?.headers?.['retry-after'] || '0', 10);
        const delay = retryAfter > 0
          ? Math.min(retryAfter * 1000, 15000)
          : Math.min(1500 * Math.pow(1.5, attempt), 10000);
        console.log(`[Groq] 429 rate limited, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
}

// ─── 캐시 ─────────────────────────────────────────────────────────────────────
const CACHE_TTL = 3 * 60 * 1000;
let cache = { data: null, ts: 0 };
let sectorListCache = { data: null, ts: 0 };

// 종목 분석 캐시 (10분 TTL)
const analysisCache = new Map();
const ANALYSIS_CACHE_TTL = 10 * 60 * 1000;

function getKSTTime() {
  return new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }) + ' KST';
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://finance.naver.com/'
};

// ─── 데이터 수집 ──────────────────────────────────────────────────────────────

async function getMarketIndex(code) {
  try {
    // Naver 모바일 API (더 안정적)
    const url = `https://m.stock.naver.com/api/index/${code}/basic`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 6000 });
    return {
      closePrice:       data.currentValue      || data.closePrice || '-',
      fluctuationsRatio: data.fluctuationsRatio || '0',
      fluctuationPrice:  data.fluctuations      || data.fluctuationPrice || '0',
      openPrice:        data.openingValue       || '-',
      highPrice:        data.highestValue       || '-',
      lowPrice:         data.lowestValue        || '-',
    };
  } catch (e) {
    console.error(`[getMarketIndex] ${code}:`, e.message);
    return {};
  }
}

// sosok: 0=KOSPI, 1=KOSDAQ
async function getRisingStocks(sosok = 0) {
  try {
    const url = `https://finance.naver.com/sise/sise_rise.naver?sosok=${sosok}`;
    const { data: buffer } = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: HEADERS,
      timeout: 8000
    });
    const html = iconv.decode(buffer, 'EUC-KR');
    const $ = cheerio.load(html);

    const stocks = [];
    $('table.type_2 tbody tr').each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 6) return;
      const name = $(tds[1]).find('a').text().trim();
      if (!name) return;
      const href = $(tds[1]).find('a').attr('href') || '';
      const codeMatch = href.match(/code=([0-9A-Z]+)/);
      stocks.push({
        name,
        code:       codeMatch ? codeMatch[1] : '',
        price:      $(tds[2]).text().trim().replace(/[\s,]/g, ''),
        change:     $(tds[3]).text().trim().replace(/[\s,]/g, ''),
        changeRate: $(tds[4]).text().trim(),
        volume:     $(tds[5]).text().trim().replace(/[\s,]/g, ''),
      });
    });
    return stocks.filter(s => s.name && s.price).slice(0, 10);
  } catch (e) {
    console.error(`[getRisingStocks] sosok=${sosok}:`, e.message);
    return [];
  }
}

// 하락률 상위 종목
async function getFallingStocks(sosok = 0) {
  try {
    const url = `https://finance.naver.com/sise/sise_fall.naver?sosok=${sosok}`;
    const { data: buffer } = await axios.get(url, {
      responseType: 'arraybuffer', headers: HEADERS, timeout: 8000
    });
    const html = iconv.decode(buffer, 'EUC-KR');
    const $ = cheerio.load(html);
    const stocks = [];
    $('table.type_2 tbody tr').each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 6) return;
      const name = $(tds[1]).find('a').text().trim();
      if (!name) return;
      const href = $(tds[1]).find('a').attr('href') || '';
      const codeMatch = href.match(/code=([0-9A-Z]+)/);
      stocks.push({
        name, code: codeMatch ? codeMatch[1] : '',
        price: $(tds[2]).text().trim().replace(/[\s,]/g, ''),
        changeRate: '-' + $(tds[4]).text().trim().replace(/[+\-%]/g, '') + '%',
        volume: $(tds[5]).text().trim().replace(/[\s,]/g, ''),
      });
    });
    return stocks.filter(s => s.name && s.price).slice(0, 5);
  } catch (e) {
    console.error(`[getFallingStocks] sosok=${sosok}:`, e.message);
    return [];
  }
}

// 시가총액 상위 종목
async function getMarketCapLeaders(sosok = 0) {
  try {
    const url = `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}`;
    const { data: buffer } = await axios.get(url, {
      responseType: 'arraybuffer', headers: HEADERS, timeout: 8000
    });
    const html = iconv.decode(buffer, 'EUC-KR');
    const $ = cheerio.load(html);
    const stocks = [];
    $('table.type_2 tbody tr').each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 7) return;
      const name = $(tds[1]).find('a').text().trim();
      if (!name) return;
      const href = $(tds[1]).find('a').attr('href') || '';
      const codeMatch = href.match(/code=([0-9A-Z]+)/);
      stocks.push({
        name, code: codeMatch ? codeMatch[1] : '',
        price: $(tds[2]).text().trim().replace(/[\s,]/g, ''),
        changeRate: $(tds[4]).text().trim(),
        marketCap: $(tds[6]).text().trim().replace(/[\s,]/g, ''),
      });
    });
    return stocks.filter(s => s.name && s.price).slice(0, 10);
  } catch (e) {
    console.error(`[getMarketCapLeaders] sosok=${sosok}:`, e.message);
    return [];
  }
}

// 거래량 상위 종목
async function getVolumeLeaders(sosok = 0) {
  try {
    const url = `https://finance.naver.com/sise/sise_quant.naver?sosok=${sosok}`;
    const { data: buffer } = await axios.get(url, {
      responseType: 'arraybuffer', headers: HEADERS, timeout: 8000
    });
    const html = iconv.decode(buffer, 'EUC-KR');
    const $ = cheerio.load(html);
    const stocks = [];
    $('table.type_2 tbody tr').each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 6) return;
      const name = $(tds[1]).find('a').text().trim();
      if (!name) return;
      const href = $(tds[1]).find('a').attr('href') || '';
      const codeMatch = href.match(/code=([0-9A-Z]+)/);
      stocks.push({
        name, code: codeMatch ? codeMatch[1] : '',
        price: $(tds[2]).text().trim().replace(/[\s,]/g, ''),
        changeRate: $(tds[4]).text().trim(),
        volume: $(tds[5]).text().trim().replace(/[\s,]/g, ''),
      });
    });
    return stocks.filter(s => s.name && s.price).slice(0, 10);
  } catch (e) {
    console.error(`[getVolumeLeaders] sosok=${sosok}:`, e.message);
    return [];
  }
}

// 섹터 등락률 상위/하위
async function getSectorPerformance() {
  try {
    const url = 'https://finance.naver.com/sise/sise_group.naver?type=upjong';
    const { data: buffer } = await axios.get(url, {
      responseType: 'arraybuffer', headers: HEADERS, timeout: 8000
    });
    const html = iconv.decode(buffer, 'EUC-KR');
    const $ = cheerio.load(html);
    const sectors = [];
    $('table.type_1 tbody tr').each((_, row) => {
      const tds = $(row).find('td');
      if (tds.length < 4) return;
      const name = $(tds[0]).find('a').text().trim();
      const rate = $(tds[1]).text().trim();
      if (!name || !rate) return;
      sectors.push({ name, changeRate: rate });
    });
    sectors.sort((a, b) => parseFloat(b.changeRate) - parseFloat(a.changeRate));
    return { top: sectors.slice(0, 5), bottom: sectors.slice(-5).reverse() };
  } catch (e) {
    console.error('[getSectorPerformance]', e.message);
    return { top: [], bottom: [] };
  }
}

// ─── AI 분석 ──────────────────────────────────────────────────────────────────

// ─── 섹터 데이터 ───────────────────────────────────────────────────────────────
async function getSectors() {
  const url = 'https://finance.naver.com/sise/sise_group.naver?type=upjong';
  const { data: buffer } = await axios.get(url, { responseType: 'arraybuffer', headers: HEADERS, timeout: 8000 });
  const html = iconv.decode(buffer, 'EUC-KR');
  const $ = cheerio.load(html);
  const sectors = [];
  $('table.type_1 tbody tr').each((_, row) => {
    const link = $(row).find('td').first().find('a');
    const name = link.text().trim();
    const href = link.attr('href') || '';
    const match = href.match(/no=(\d+)/);
    if (name && match) sectors.push({ name, no: match[1] });
  });
  return sectors;
}

async function getSectorStocks(no) {
  const url = `https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${no}`;
  const { data: buffer } = await axios.get(url, { responseType: 'arraybuffer', headers: HEADERS, timeout: 8000 });
  const html = iconv.decode(buffer, 'EUC-KR');
  const $ = cheerio.load(html);
  const stocks = [];
  const rows = $('table.type_5 tbody tr').length
    ? $('table.type_5 tbody tr')
    : $('table tbody tr');
  rows.each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 4) return;
    const nameEl = $(tds[0]).find('a');
    const name = nameEl.text().trim();
    if (!name) return;
    const href = nameEl.attr('href') || '';
    const codeMatch = href.match(/code=([0-9A-Z]+)/);
    const price = $(tds[1]).text().trim().replace(/[,\s]/g, '');
    const changeRate = $(tds[3]).text().trim();
    const volume = tds.length > 6 ? $(tds[6]).text().trim().replace(/[,\s]/g, '') : '';
    if (!price || isNaN(parseInt(price))) return;
    stocks.push({ name, code: codeMatch ? codeMatch[1] : '', price, changeRate, volume });
  });
  return stocks.slice(0, 15);
}

async function analyzeSectorWithAI(sectorName, stocks) {
  const fmtList = stocks.slice(0, 10).map((s, i) =>
    `${i + 1}. ${s.name}(${s.code}) | 현재가 ${Number(s.price).toLocaleString()}원 | 등락률 ${s.changeRate}`
  ).join('\n');

  const prompt = `당신은 한국 주식 전문 애널리스트입니다. 아래 "${sectorName}" 섹터 데이터를 분석하고 투자 추천을 JSON으로만 답변해주세요.

## ${sectorName} 섹터 주요 종목
${fmtList}

다음 JSON 형식으로만 답변:
{
  "sectorOutlook": "섹터 현황 및 향후 전망 요약 (3~4줄)",
  "sentiment": "BULLISH 또는 BEARISH 또는 NEUTRAL",
  "sentimentKo": "강세 또는 약세 또는 중립",
  "catalysts": ["성장 동인1", "성장 동인2", "성장 동인3"],
  "recommendations": [
    {
      "rank": 1,
      "name": "종목명",
      "code": "종목코드(6자리 숫자)",
      "currentPrice": "현재가(숫자만)",
      "changeRate": "등락률",
      "reason": "추천 이유 (기술적/펀더멘탈 분석, 3~4줄)",
      "forecast": "향후 1~3개월 전망 (가격 방향, 주요 이벤트)",
      "targetPrice": "목표주가(숫자만)",
      "riskLevel": "낮음 또는 중간 또는 높음",
      "strategy": "단기 또는 중기 또는 장기"
    }
  ],
  "risks": ["리스크1", "리스크2", "리스크3"],
  "disclaimer": "이 분석은 참고용이며 투자 손실에 대한 책임을 지지 않습니다."
}
recommendations는 3개 선정해 주세요.`;

  const response = await callGroq({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: '한국 주식 전문 애널리스트. JSON 형식으로만 답변합니다.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 1500
  });
  const parsed = JSON.parse(response.data.choices[0].message.content);
  // AI가 code를 누락할 수 있으므로 원본 데이터에서 매칭
  if (parsed.recommendations) {
    const codeMap = Object.fromEntries(stocks.map(s => [s.name.trim(), s.code]));
    parsed.recommendations.forEach(r => {
      if (!r.code) r.code = codeMap[r.name?.trim()] || '';
    });
  }
  return parsed;
}

async function analyzeWithAI(market, stocks, extra = {}) {
  const fmtIdx = (idx) =>
    `${idx.closePrice || 'N/A'}pt (${parseFloat(idx.fluctuationsRatio) > 0 ? '+' : ''}${idx.fluctuationsRatio || 0}%)`;

  const fmtList = (list, max = 5) =>
    list.slice(0, max).map((s, i) =>
      `${i + 1}. ${s.name}(${s.code || '?'}) | ${Number(s.price).toLocaleString()}원 | ${s.changeRate}${s.volume ? ' | 거래량 ' + Number(s.volume).toLocaleString() : ''}${s.marketCap ? ' | 시총 ' + Number(s.marketCap).toLocaleString() + '억' : ''}`
    ).join('\n');

  const fmtSectors = (list) =>
    list.map((s, i) => `${i + 1}. ${s.name} (${s.changeRate}%)`).join('\n');

  const systemPrompt = `당신은 한국 주식시장 전문 애널리스트입니다. 단순히 오늘 상승한 종목을 나열하지 마세요.
다음 분석 원칙을 따르세요:
1. **시장 맥락**: 지수 흐름, 섹터 순환, 수급 동향을 종합하여 시장 방향성을 판단하세요.
2. **Multi-dimensional 분석**: 시가총액 대형주의 안정성, 거래량 급증 종목의 수급 시그널, 하락 종목 중 반등 가능성을 모두 고려하세요.
3. **투자자 성향 반영**: 
   - 우량주(대형 블루칩): 장기 적립식 매수 관점 → 저가 매수 기회 탐색
   - 성장주/소형주: 단기 트레이딩 관점 → 모멘텀과 거래량 동반 확인
4. **단순 상승률 추종 금지**: 오늘 급등한 종목을 그대로 추천하지 마세요. 추가 상승 여력, 밸류에이션, 업종 전망을 분석하세요.
5. **균형 잡힌 포트폴리오**: 대형 안정주 + 성장 모멘텀주 + 가치주를 혼합 추천하세요.

JSON 형식으로만 답변합니다.`;

  const prompt = `아래 한국 주식시장의 다차원 데이터를 종합 분석하여 투자 추천을 해주세요.

## 1. 현재 시장 지수
- KOSPI: ${fmtIdx(market.kospi)} (고가: ${market.kospi.highPrice || '-'} / 저가: ${market.kospi.lowPrice || '-'})
- KOSDAQ: ${fmtIdx(market.kosdaq)} (고가: ${market.kosdaq.highPrice || '-'} / 저가: ${market.kosdaq.lowPrice || '-'})

## 2. 섹터 동향
### 상승 섹터 TOP 5
${extra.sectorTop ? fmtSectors(extra.sectorTop) : '데이터 없음'}
### 하락 섹터 TOP 5
${extra.sectorBottom ? fmtSectors(extra.sectorBottom) : '데이터 없음'}

## 3. 시가총액 상위 (대형주 동향)
### KOSPI 대형주
${extra.capKospi ? fmtList(extra.capKospi, 7) : '데이터 없음'}
### KOSDAQ 대형주
${extra.capKosdaq ? fmtList(extra.capKosdaq, 5) : '데이터 없음'}

## 4. 거래량 상위 (수급 시그널)
### KOSPI 거래량 TOP
${extra.volKospi ? fmtList(extra.volKospi, 5) : '데이터 없음'}
### KOSDAQ 거래량 TOP
${extra.volKosdaq ? fmtList(extra.volKosdaq, 5) : '데이터 없음'}

## 5. 상승률 상위
### KOSPI
${fmtList(stocks.kospi, 5)}
### KOSDAQ
${fmtList(stocks.kosdaq, 5)}

## 6. 하락률 상위 (반등 기회 탐색)
### KOSPI
${extra.fallKospi ? fmtList(extra.fallKospi, 5) : '데이터 없음'}
### KOSDAQ
${extra.fallKosdaq ? fmtList(extra.fallKosdaq, 5) : '데이터 없음'}

## 분석 요청사항
- 위 데이터를 **종합적으로** 분석하세요.
- 단순 상승률 Top 종목을 나열하지 말고, 시장 흐름·섹터 트렌드·수급·밸류에이션을 고려하여 추천하세요.
- 대형 우량주(장기 관점) 2개 + 성장/모멘텀주(중단기) 2개 + 가치/역발상(반등 기대) 1개로 구성하세요.
- 각 종목의 code(종목코드 6자리)를 반드시 포함하세요.

다음 JSON 형식으로만 답변:
{
  "marketSummary": "시장 분위기·섹터 순환·수급 동향 종합 요약 (4~5줄)",
  "sentiment": "BULLISH 또는 BEARISH 또는 NEUTRAL",
  "sentimentKo": "강세 또는 약세 또는 중립",
  "recommendations": [
    {
      "rank": 1,
      "name": "종목명",
      "code": "종목코드(6자리 숫자)",
      "market": "KOSPI 또는 KOSDAQ",
      "currentPrice": "현재가(숫자만)",
      "changeRate": "오늘 등락률",
      "reason": "추천 이유 (시장 맥락, 섹터 위치, 수급, 밸류에이션, 기술적 분석 종합. 4~5줄)",
      "strategy": "단기 또는 중기 또는 장기",
      "riskLevel": "낮음 또는 중간 또는 높음",
      "targetReturn": "예상 수익률 (예: 5~10%)",
      "category": "우량주 또는 성장주 또는 가치주"
    }
  ],
  "sectorInsight": "주목할 섹터와 이유 (2~3줄)",
  "cautions": ["주의사항1", "주의사항2", "주의사항3"],
  "disclaimer": "이 분석은 참고용이며 투자 손실에 대한 책임을 지지 않습니다."
}
recommendations는 5개 선정해 주세요.`;

  const response = await callGroq({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 2000
  });

  return JSON.parse(response.data.choices[0].message.content);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/market', async (req, res) => {
  try {
    const [kospi, kosdaq] = await Promise.all([
      getMarketIndex('KOSPI'),
      getMarketIndex('KOSDAQ')
    ]);
    res.json({ kospi, kosdaq, dataDate: getKSTTime() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const [kospi, kosdaq] = await Promise.all([
      getRisingStocks(0),
      getRisingStocks(1)
    ]);
    res.json({ kospi, kosdaq, dataDate: getKSTTime() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recommend', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && now - cache.ts < CACHE_TTL) {
      console.log('[cache] hit');
      return res.json({ ...cache.data, cached: true });
    }

    console.log('[recommend] 다차원 데이터 수집 시작...');
    const [
      [kospiIdx, kosdaqIdx],
      [kospiStocks, kosdaqStocks],
      [fallKospi, fallKosdaq],
      [capKospi, capKosdaq],
      [volKospi, volKosdaq],
      sectorPerf,
    ] = await Promise.all([
      Promise.all([getMarketIndex('KOSPI'), getMarketIndex('KOSDAQ')]),
      Promise.all([getRisingStocks(0), getRisingStocks(1)]),
      Promise.all([getFallingStocks(0), getFallingStocks(1)]),
      Promise.all([getMarketCapLeaders(0), getMarketCapLeaders(1)]),
      Promise.all([getVolumeLeaders(0), getVolumeLeaders(1)]),
      getSectorPerformance(),
    ]);
    console.log('[recommend] 데이터 수집 완료, AI 분석 시작...');

    const market = { kospi: kospiIdx, kosdaq: kosdaqIdx };
    const stocks = { kospi: kospiStocks, kosdaq: kosdaqStocks };
    const extra = {
      fallKospi, fallKosdaq,
      capKospi, capKosdaq,
      volKospi, volKosdaq,
      sectorTop: sectorPerf.top,
      sectorBottom: sectorPerf.bottom,
    };
    const recommendation = await analyzeWithAI(market, stocks, extra);

    // 스크래핑 데이터에서 종목코드 매칭
    const allStocks = [...kospiStocks, ...kosdaqStocks, ...capKospi, ...capKosdaq, ...volKospi, ...volKosdaq, ...fallKospi, ...fallKosdaq];
    if (recommendation?.recommendations) {
      recommendation.recommendations = recommendation.recommendations.map(rec => {
        if (rec.code) return rec;
        const found = allStocks.find(s =>
          s.name === rec.name || s.name.includes(rec.name) || rec.name.includes(s.name)
        );
        return found ? { ...rec, code: found.code } : rec;
      });
    }

    const result = { market, stocks, recommendation, generatedAt: new Date().toISOString(), dataDate: getKSTTime() };
    cache = { data: result, ts: now };
    res.json(result);
  } catch (e) {
    console.error('[/api/recommend]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sectors', async (req, res) => {
  try {
    const now = Date.now();
    if (sectorListCache.data && now - sectorListCache.ts < 30 * 60 * 1000) {
      return res.json(sectorListCache.data);
    }
    const sectors = await getSectors();
    sectorListCache = { data: sectors, ts: now };
    res.json(sectors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sector', async (req, res) => {
  try {
    const { no, name } = req.query;
    if (!no) return res.status(400).json({ error: 'no 파라미터가 필요합니다' });
    const stocks = await getSectorStocks(no);
    if (stocks.length === 0) return res.status(404).json({ error: '종목 데이터를 가져올 수 없습니다' });
    const analysis = await analyzeSectorWithAI(name || '해당 섹터', stocks);
    res.json({ sectorName: name, stocks, analysis, dataDate: getKSTTime() });
  } catch (e) {
    console.error('[/api/sector]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 종목 검색 (이름 → 종목코드)
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'q 파라미터가 필요합니다' });

    const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&q_enc=UTF-8&target=stock`;
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 5000 });

    // items: [{ code, name, typeCode, typeName, ... }]
    const items = (data.items || []).map(item => ({
      name: item.name,
      code: item.code,
      market: item.typeName || item.typeCode,
    }));
    res.json(items.slice(0, 20));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 차트 Helper ──────────────────────────────────────────────────────────────
async function fetchSisePage(code, page) {
  const url = `https://finance.naver.com/item/sise_day.naver?code=${code}&page=${page}`;
  const { data: buf } = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { ...HEADERS, Referer: `https://finance.naver.com/item/main.naver?code=${code}` },
    timeout: 6000,
  });
  const html = iconv.decode(buf, 'EUC-KR');
  const $ = cheerio.load(html);
  const rows = [];
  $('table.type2 tbody tr').each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 7) return;
    const dateText = $(tds[0]).text().trim();
    if (!dateText.match(/^\d{4}\.\d{2}/)) return;
    const close  = parseInt($(tds[1]).text().trim().replace(/[,\s]/g, '')) || 0;
    const open   = parseInt($(tds[3]).text().trim().replace(/[,\s]/g, '')) || 0;
    const high   = parseInt($(tds[4]).text().trim().replace(/[,\s]/g, '')) || 0;
    const low    = parseInt($(tds[5]).text().trim().replace(/[,\s]/g, '')) || 0;
    const volume = parseInt($(tds[6]).text().trim().replace(/[,\s]/g, '')) || 0;
    if (!close) return;
    rows.push({ date: dateText.replace(/\./g, ''), open, high, low, close, volume });
  });
  return rows;
}

async function fetchSisePages(code, totalPages, batchSize = 5) {
  const all = [];
  for (let start = 1; start <= totalPages; start += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, totalPages - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(batch.map(p => fetchSisePage(code, p).catch(() => [])));
    results.forEach(rows => all.push(...rows));
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

// 차트 데이터 (일/주/월/년)
app.get('/api/chart', async (req, res) => {
  try {
    const { code, period = 'day' } = req.query;
    if (!code) return res.status(400).json({ error: 'code 파라미터가 필요합니다' });

    // 기간별 수집 페이지 수 (1페이지 ≈ 10 거래일)
    const pageMap = { day: 6, week: 26, month: 52, year: 130 };
    const totalPages = pageMap[period] || 6;
    const candles = await fetchSisePages(code, totalPages);

    if (candles.length === 0) return res.status(404).json({ error: '데이터 없음 (종목코드 확인)' });

    if (period === 'day') return res.json(candles);

    // 주봉 집계 (ISO 주차)
    if (period === 'week') {
      const byWeek = {};
      candles.forEach(c => {
        const d = new Date(`${c.date.slice(0,4)}-${c.date.slice(4,6)}-${c.date.slice(6,8)}`);
        const yr = d.getFullYear();
        const weekNum = Math.ceil(((d - new Date(yr, 0, 1)) / 86400000 + (new Date(yr, 0, 1).getDay() + 1)) / 7);
        const key = `${yr}W${String(weekNum).padStart(2,'0')}`;
        if (!byWeek[key]) byWeek[key] = { date: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
        else {
          byWeek[key].high   = Math.max(byWeek[key].high, c.high);
          byWeek[key].low    = Math.min(byWeek[key].low, c.low);
          byWeek[key].close  = c.close;
          byWeek[key].volume += c.volume;
        }
      });
      return res.json(Object.values(byWeek).sort((a,b) => a.date.localeCompare(b.date)));
    }

    // 월봉 집계
    if (period === 'month') {
      const byMonth = {};
      candles.forEach(c => {
        const key = c.date.slice(0, 6); // YYYYMM
        if (!byMonth[key]) byMonth[key] = { date: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
        else {
          byMonth[key].high   = Math.max(byMonth[key].high, c.high);
          byMonth[key].low    = Math.min(byMonth[key].low, c.low);
          byMonth[key].close  = c.close;
          byMonth[key].volume += c.volume;
        }
      });
      return res.json(Object.values(byMonth).sort((a,b) => a.date.localeCompare(b.date)));
    }

    // 년봉 집계
    if (period === 'year') {
      const byYear = {};
      candles.forEach(c => {
        const key = c.date.slice(0, 4);
        if (!byYear[key]) byYear[key] = { date: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
        else {
          byYear[key].high   = Math.max(byYear[key].high, c.high);
          byYear[key].low    = Math.min(byYear[key].low, c.low);
          byYear[key].close  = c.close;
          byYear[key].volume += c.volume;
        }
      });
      return res.json(Object.values(byYear).sort((a,b) => a.date.localeCompare(b.date)));
    }

    res.json(candles);
  } catch (e) {
    console.error('[/api/chart]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 종목 주요 재무 지표
app.get('/api/stockinfo', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'code가 필요합니다' });

    const info = { code };

    // 1) Naver 모바일 API — basic (현재가·이름)
    try {
      const { data } = await axios.get(
        `https://m.stock.naver.com/api/stock/${code}/basic`,
        { headers: HEADERS, timeout: 6000 }
      );
      info.name          = data.stockName || data.itemName || data.corporateName;
      info.currentPrice  = data.closePrice  || data.stockPrice;
      info.changeRate    = data.fluctuationsRatio;
      info.market        = data.stockExchangeName || null;
    } catch (e1) {
      console.error('[stockinfo basic]', e1.message);
    }

    // 2) Naver 모바일 API — integration (시총, 거래량, 52주, PER 등 풍부한 데이터)
    try {
      const { data: integ } = await axios.get(
        `https://m.stock.naver.com/api/stock/${code}/integration`,
        { headers: HEADERS, timeout: 6000 }
      );
      if (!info.name && integ.stockName) info.name = integ.stockName;
      if (integ.description) info.sector = integ.description;
      if (integ.industryCode) info.industryCode = integ.industryCode;

      // totalInfos → key/value 매핑
      const ti = {};
      (integ.totalInfos || []).forEach(t => { ti[t.code] = t.value; });
      info.marketCap     = ti.marketValue        || null;
      info.volume        = ti.accumulatedTradingVolume || null;
      info.tradingValue  = ti.accumulatedTradingValue  || null;
      info.foreignRate   = ti.foreignRate        || null;
      info.high52w       = ti.highPriceOf52Weeks || null;
      info.low52w        = ti.lowPriceOf52Weeks  || null;
      info.per           = ti.per?.replace(/배$/, '')   || null;
      info.eps           = ti.eps?.replace(/원$/, '')?.replace(/,/g, '') || null;
      info.pbr           = ti.pbr?.replace(/배$/, '')   || null;
      info.bps           = ti.bps?.replace(/원$/, '')?.replace(/,/g, '') || null;
      info.dividendYield = ti.dividendYieldRatio?.replace(/%$/, '') || null;
      info.dividend      = ti.dividend?.replace(/원$/, '')?.replace(/,/g, '') || null;
      info.estimatedPer  = ti.cnsPer?.replace(/배$/, '') || null;
      info.estimatedEps  = ti.cnsEps?.replace(/원$/, '')?.replace(/,/g, '') || null;
      info.openPrice     = ti.openPrice || null;
      info.highPrice     = ti.highPrice || null;
      info.lowPrice      = ti.lowPrice  || null;
      info.prevClose     = ti.lastClosePrice || null;
    } catch (e2) {
      console.error('[stockinfo integration]', e2.message);
      // fallback: 기존 scrapeMetrics
      try {
        const m = await scrapeMetrics(code);
        Object.assign(info, m);
      } catch (e3) {
        console.error('[stockinfo scrape fallback]', e3.message);
      }
    }

    // 3) 종목명 최후 보완 (자동완성)
    if (!info.name) {
      try {
        const { data: ac } = await axios.get(
          `https://ac.finance.naver.com/ac?q=${code}&q_enc=UTF-8&target=stock`,
          { headers: HEADERS, timeout: 4000 }
        );
        const found = (ac.items || []).flat().find(([, c]) => c === code);
        if (found) info.name = found[0];
      } catch {}
    }

    res.json(info);
  } catch (e) {
    console.error('[/api/stockinfo]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── 종목 최신 뉴스 스크래핑 (3개월 이내) ────────────────────────────────────
async function fetchStockNews(code) {
  const url = `https://finance.naver.com/item/news_news.naver?code=${code}&page=1&sm=title_entity_id.basic&clusterId=`;
  const { data: buf } = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { ...HEADERS, Referer: `https://finance.naver.com/item/main.naver?code=${code}` },
    timeout: 6000,
  });
  const html = iconv.decode(buf, 'EUC-KR');
  const $ = cheerio.load(html);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);

  const news = [];
  $('tr').each((_, row) => {
    const titleEl = $(row).find('a.tit');
    const dateEl  = $(row).find('td.date');
    const title   = titleEl.text().trim();
    const dateStr = dateEl.first().text().trim(); // "2026.03.22 20:24"
    if (!title || !dateStr || !dateStr.match(/\d{4}\.\d{2}\.\d{2}/)) return;

    const dateOnly = dateStr.match(/(\d{4}\.\d{2}\.\d{2})/)[1];
    const date = new Date(dateOnly.replace(/\./g, '-'));
    if (isNaN(date) || date < cutoff) return;
    news.push({ title, date: dateOnly });
  });

  return news.slice(0, 10);
}

// ─── 재무지표 스크래핑 공통 헬퍼 ─────────────────────────────────────────────
async function scrapeMetrics(code) {
  const url = `https://finance.naver.com/item/coinfo.naver?code=${code}&target=cn`;
  const { data: buf } = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { ...HEADERS, Referer: `https://finance.naver.com/item/main.naver?code=${code}` },
    timeout: 5000,
  });
  const html = iconv.decode(buf, 'EUC-KR');
  const $ = cheerio.load(html);
  const numFromCell = (text) => {
    const m = String(text).replace(/,/g, '').match(/-?\d+\.?\d*/);
    return m ? m[0] : null;
  };
  const result = {};
  $('table.per_table tr').each((_, row) => {
    const th = $(row).find('th').text();
    const tds = $(row).find('td');
    if (/PER/.test(th) && !/추정/.test(th)) {
      const parts = tds.first().text().replace(/\s+/g, ' ').trim().split(/\s*l\s*/);
      if (parts[0]) result.per = numFromCell(parts[0]);
      if (parts[1]) result.eps = numFromCell(parts[1]);
    }
    if (/추정PER/.test(th)) {
      const parts = tds.first().text().replace(/\s+/g, ' ').trim().split(/\s*l\s*/);
      if (parts[0]) result.estimatedPer = numFromCell(parts[0]);
      if (parts[1]) result.estimatedEps = numFromCell(parts[1]);
    }
    if (/PBR/.test(th)) {
      const parts = tds.first().text().replace(/\s+/g, ' ').trim().split(/\s*l\s*/);
      const v = numFromCell(parts[0]); if (v) result.pbr = v;
      if (parts[1]) result.bps = numFromCell(parts[1]);
    }
    if (/배당수익률/.test(th)) {
      const v = numFromCell(tds.first().text().trim()); if (v) result.dividendYield = v;
    }
  });
  return result;
}

// ─── 재무제표 (연간 + 분기) ─────────────────────────────────────────────────
app.get('/api/financial-statements', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'code가 필요합니다' });

    const [annualRes, quarterRes] = await Promise.all([
      axios.get(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, {
        headers: HEADERS, timeout: 8000,
      }).catch(() => null),
      axios.get(`https://m.stock.naver.com/api/stock/${code}/finance/quarter`, {
        headers: HEADERS, timeout: 8000,
      }).catch(() => null),
    ]);

    const formatData = (raw) => {
      if (!raw?.data?.financeInfo) return null;
      const { trTitleList, rowList } = raw.data.financeInfo;
      const periods = trTitleList.map(t => ({
        key: t.key,
        title: t.title.replace(/\.$/, ''),
        isEstimate: t.isConsensus === 'Y',
      }));
      const rows = rowList.map(r => ({
        title: r.title,
        values: periods.map(p => ({
          period: p.key,
          value: r.columns[p.key]?.value ?? '-',
        })),
      }));
      return { periods, rows };
    };

    const annual = formatData(annualRes);
    const quarter = formatData(quarterRes);
    const summary = annualRes?.data?.corporationSummary || null;

    if (!annual && !quarter) {
      return res.status(404).json({ error: '재무제표 데이터를 찾을 수 없습니다' });
    }

    res.json({ code, annual, quarter, summary });
  } catch (e) {
    console.error('[/api/financial-statements]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── 재무제표 AI 분석 ───────────────────────────────────────────────────────
app.post('/api/analyze-financials', async (req, res) => {
  try {
    const { code, name, annual, quarter, summary } = req.body;
    if (!code) return res.status(400).json({ error: 'code가 필요합니다' });
    if (!annual && !quarter) return res.status(400).json({ error: '재무 데이터가 없습니다' });

    // 재무제표 텍스트로 변환
    const formatSheet = (sheet, label) => {
      if (!sheet) return '';
      const header = `[${label}] 기간: ${sheet.periods.map(p => p.title + (p.isEstimate ? '(E)' : '')).join(' | ')}`;
      const rows = sheet.rows.map(r => {
        const vals = r.values.map(v => v.value).join(' | ');
        return `${r.title}: ${vals}`;
      }).join('\n');
      return `${header}\n${rows}`;
    };

    const annualText = formatSheet(annual, '연간');
    const quarterText = formatSheet(quarter, '분기');
    const summaryText = summary
      ? [summary.comment1, summary.comment2, summary.comment3].filter(Boolean).join(' ')
      : '';

    const prompt = `당신은 한국 주식시장 전문 재무 분석가입니다. 아래 재무제표 데이터를 주식 투자 관점에서 분석해주세요.

## 종목: ${name || code} (${code})
${summaryText ? `## 기업 개요: ${summaryText}` : ''}

## 재무제표 데이터
${annualText}

${quarterText}

위 재무제표 데이터를 기반으로 다음 JSON 형식으로만 답변하세요:
{
  "overallGrade": "A+ 또는 A 또는 B+ 또는 B 또는 C 또는 D (종합 재무 등급)",
  "overallComment": "종합 재무 상태 평가 한 줄 요약",
  "profitability": {
    "grade": "좋음 또는 보통 또는 주의",
    "analysis": "매출액, 영업이익, 순이익 추이를 분석한 수익성 평가 (3~4줄, 구체적 수치 인용)"
  },
  "growth": {
    "grade": "좋음 또는 보통 또는 주의",
    "analysis": "매출/영업이익 성장률, 전년 대비 추이를 분석한 성장성 평가 (3~4줄, 구체적 수치 인용)"
  },
  "stability": {
    "grade": "좋음 또는 보통 또는 주의",
    "analysis": "부채비율, 유보율, 자본 구조를 분석한 재무 안정성 평가 (3~4줄, 구체적 수치 인용)"
  },
  "efficiency": {
    "grade": "좋음 또는 보통 또는 주의",
    "analysis": "ROE, 영업이익률 등을 분석한 경영 효율성 평가 (3~4줄, 구체적 수치 인용)"
  },
  "quarterTrend": {
    "grade": "좋음 또는 보통 또는 주의",
    "analysis": "최근 분기별 실적 추이와 계절성 분석 (3~4줄, 구체적 수치 인용)"
  },
  "investmentOpinion": "투자 의견 종합 - 재무제표 기반으로 이 종목의 매수/보유/매도 근거를 3~4줄로 설명. 초보 투자자도 이해 가능하게.",
  "keyRisks": ["재무제표에서 발견된 리스크1", "리스크2"],
  "keyStrengths": ["재무적 강점1", "강점2"]
}
반드시 실제 재무 데이터의 구체적 수치를 인용하며 분석하세요. 추정치(E)가 있으면 시장 컨센서스 기대치도 언급하세요.`;

    const response = await callGroq({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: '한국 주식시장 전문 재무 분석가. JSON만 답변.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 1500,
    });
    const analysis = JSON.parse(response.data.choices[0].message.content);
    res.json({ code, name: name || code, analysis });
  } catch (e) {
    console.error('[/api/analyze-financials]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 종목 심층 분석 (재무지표 + LLM 설명)
app.get('/api/analyze-stock', async (req, res) => {
  try {
    const { code, name, reason, strategy, riskLevel, targetReturn } = req.query;
    if (!code) return res.status(400).json({ error: 'code가 필요합니다' });

    // 캐시 확인
    const cached = analysisCache.get(code);
    if (cached && Date.now() - cached.ts < ANALYSIS_CACHE_TTL) {
      console.log(`[analyze-stock] cache hit: ${code}`);
      return res.json(cached.data);
    }

    // 1) 재무지표 + 현재가 + 최신 뉴스 병렬 수집
    const [metrics, currentPrice, recentNews] = await Promise.all([
      scrapeMetrics(code).catch(e => { console.error('[analyze-stock metrics]', e.message); return {}; }),
      axios.get(`https://m.stock.naver.com/api/stock/${code}/basic`, { headers: HEADERS, timeout: 4000 })
        .then(r => r.data.closePrice || r.data.stockPrice).catch(() => null),
      fetchStockNews(code).catch(() => []),
    ]);

    // 2) LLM 분석
    const metricLines = [
      metrics.per          ? `- PER: ${metrics.per}배` : null,
      metrics.eps          ? `- EPS: ${Number(metrics.eps).toLocaleString()}원` : null,
      metrics.estimatedPer ? `- 추정PER: ${metrics.estimatedPer}배` : null,
      metrics.pbr          ? `- PBR: ${metrics.pbr}배` : null,
      metrics.bps          ? `- BPS: ${Number(metrics.bps).toLocaleString()}원` : null,
      metrics.dividendYield ? `- 배당수익률: ${metrics.dividendYield}%` : null,
    ].filter(Boolean).join('\n') || '지표 조회 불가';

    const newsLines = recentNews.length > 0
      ? recentNews.map((n, i) => `${i + 1}. [${n.date}] ${n.title}`).join('\n')
      : '뉴스 조회 불가';

    const prompt = `당신은 친절한 한국 주식 투자 교육 전문가입니다. 초보 투자자가 읽어도 이해할 수 있도록 쉽게 설명해주세요.

## 종목: ${name || code} (${code})
## AI 선정 이유: ${reason || '없음'}
## 전략: ${strategy || '-'} | 리스크: ${riskLevel || '-'} | 목표수익률: ${targetReturn || '-'}
## 현재 재무지표
${metricLines}

## 최근 뉴스 (실제 수집된 최신 기사 제목)
${newsLines}

다음 JSON 형식으로만 답변하세요:
{
  "summary": "이 종목 핵심 한 줄 요약 (50자 이내, 쉬운 말로)",
  "businessOverview": "주요 사업 분야 및 비즈니스 모델 설명 (3~4줄, 주요 제품/서비스 포함)",
  "technology": "핵심 기술 역량 및 R&D 특징 (3~4줄, 보유 기술·특허·연구 분야 포함)",
  "marketPosition": "시장에서의 위치와 평가 (3~4줄, 국내외 시장점유율·브랜드 가치·업계 평판 포함)",
  "competitors": [
    { "name": "경쟁사명", "region": "국내 또는 해외", "note": "한 줄 비교 특징" }
  ],
  "recentHighlights": [
    "위의 최근 뉴스를 기반으로 한 핵심 이슈 요약 1 (날짜 포함)",
    "위의 최근 뉴스를 기반으로 한 핵심 이슈 요약 2 (날짜 포함)",
    "위의 최근 뉴스를 기반으로 한 핵심 이슈 요약 3 (날짜 포함)"
  ],
  "whySelected": "왜 AI가 이 종목을 선정했는지 초보자용 설명 (4~5줄, 전문용어 최소화, 구체적으로)",
  "metricAnalysis": [
    {
      "metric": "지표명 (예: PER)",
      "value": "값 (예: 12.5배)",
      "easyExplain": "이 지표가 무엇인지 한 줄 설명",
      "verdict": "좋음 또는 보통 또는 주의",
      "verdictReason": "이 종목에서 이 값이 좋은/나쁜 이유 한 줄"
    }
  ],
  "investmentPoints": ["핵심 투자 포인트1", "핵심 투자 포인트2", "핵심 투자 포인트3"],
  "warnings": ["주의할 점1", "주의할 점2"],
  "beginnerTip": "초보 투자자를 위한 한 줄 핵심 조언"
}
metricAnalysis는 제공된 지표만 포함. 존재하지 않는 지표는 생략. competitors는 2~4개 선정. recentHighlights는 반드시 제공된 최근 뉴스 내용을 기반으로 작성.`;

    const response = await callGroq({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: '친절한 한국 주식 투자 교육 전문가. JSON만 답변.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000,
    });
    const analysis = JSON.parse(response.data.choices[0].message.content);
    const result = { code, name: name || code, currentPrice, metrics, analysis };
    analysisCache.set(code, { data: result, ts: Date.now() });
    res.json(result);
  } catch (e) {
    console.error('[/api/analyze-stock]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── 시세 추종: 저장된 종목 실시간 매수/매도/유지 판단 ───────────────────────
app.post('/api/track-stocks', async (req, res) => {
  try {
    const { stocks } = req.body;  // [{ code, name, price (저장 당시), strategy, reason }]
    if (!stocks || !stocks.length) return res.status(400).json({ error: '추적할 종목이 없습니다' });

    // 1) 현재 시세 + 지표 병렬 수집
    const enriched = await Promise.all(stocks.slice(0, 20).map(async (s) => {
      try {
        const [basicRes, intRes] = await Promise.all([
          axios.get(`https://m.stock.naver.com/api/stock/${s.code}/basic`, { headers: HEADERS, timeout: 6000 }).catch(() => null),
          axios.get(`https://m.stock.naver.com/api/stock/${s.code}/integration`, { headers: HEADERS, timeout: 6000 }).catch(() => null),
        ]);
        const basic = basicRes?.data || {};
        const integ = intRes?.data || {};
        const ti = {};
        (integ.totalInfos || []).forEach(t => { ti[t.code] = t.value; });

        return {
          code: s.code,
          name: s.name || basic.stockName || s.code,
          savedPrice: s.price,
          buyDate: s.buyDate || '',
          savedStrategy: s.strategy || '-',
          savedReason: s.reason || '',
          currentPrice: basic.closePrice || basic.stockPrice || '-',
          changeRate: basic.fluctuationsRatio || '0',
          changePx: basic.fluctuations || '0',
          high: ti.highPrice || '-',
          low: ti.lowPrice || '-',
          volume: ti.accumulatedTradingVolume || '-',
          per: ti.per || '-',
          high52w: ti.highPriceOf52Weeks || '-',
          low52w: ti.lowPriceOf52Weeks || '-',
          foreignRate: ti.foreignRate || '-',
        };
      } catch {
        return { code: s.code, name: s.name || s.code, savedPrice: s.price, currentPrice: '-', error: true };
      }
    }));

    // 2) AI 판단
    const stockLines = enriched.map((s, i) => {
      if (s.error) return `${i + 1}. ${s.name}(${s.code}) — 시세 조회 실패`;
      const savedNum = parseInt(String(s.savedPrice).replace(/,/g, ''), 10) || 0;
      const curNum = parseInt(String(s.currentPrice).replace(/,/g, ''), 10) || 0;
      const pnl = savedNum > 0 ? (((curNum - savedNum) / savedNum) * 100).toFixed(2) : '?';
      const holdDays = s.buyDate ? Math.floor((Date.now() - new Date(s.buyDate).getTime()) / 86400000) : '?';
      return `${i + 1}. ${s.name}(${s.code}) | 매수일: ${s.buyDate || '미입력'} (보유 ${holdDays}일) | 매수가: ${s.savedPrice}원 → 현재가: ${s.currentPrice}원 (수익률: ${pnl}%) | 등락률: ${s.changeRate}% | PER: ${s.per} | 52주고가: ${s.high52w} 저가: ${s.low52w} | 외국인비율: ${s.foreignRate} | 거래량: ${s.volume} | 전략: ${s.savedStrategy} | 기존분석: ${s.savedReason}`;
    }).join('\n');

    const prompt = `당신은 한국 주식시장 전문 트레이딩 어드바이저입니다.
사용자가 보유 중인 종목의 **현재 실시간 시세**를 기반으로, 각 종목별로 지금 바로 매수(추가매수)/매도/유지 중 어떤 행동을 해야 하는지 판단해 주세요.

## 사용자 투자 전략
- **우량주 (대형주, 시가총액 상위 기업)**: 장기 보유 및 지속 매수(적립식) 목표. 일시적 하락은 추가 매수 기회로 판단. 매도는 펀더멘탈 훼손이나 심각한 구조적 문제가 있을 때만 권고.
- **성장주 / 소규모 회사 (중소형주)**: 단기 상승 차익 목표. 모멘텀이 꺾이거나 목표 수익률 도달 시 빠른 익절 권고. 하락 추세 진입 시 과감한 손절 권고.
- **공통**: 재무제표(PER, PBR, ROE, 부채비율 등) 펀더멘탈을 기본 반영하되, **현재 가격 트렌드(이동평균선, 거래량 변화, 52주 고저 대비 위치)와 시장 모멘텀**을 중심으로 판단.

## 중요: "매수가"는 사용자가 실제로 해당 종목을 매수한 가격입니다.
- 수익률은 반드시 (현재가 - 매수가) / 매수가 × 100 으로 계산하세요.
- 매수가 대비 현재 손익 상황을 핵심 판단 근거에 반드시 포함하세요.
- 손절/익절 판단 시 매수가 기준으로 분석하세요.
- **매수일과 보유 기간**을 반드시 고려하세요. 우량주는 보유 기간이 길수록 장기 전략에 부합. 성장주/소형주는 보유 기간이 길어지면 모멘텀 약화 여부를 확인하세요.

## 보유 종목 현재 시세
${stockLines}

## 분석 시각: ${getKSTTime()}

다음 JSON 형식으로만 답변하세요:
{
  "marketContext": "현재 전반적 시장 분위기 한 줄 요약",
  "analysisTime": "${getKSTTime()}",
  "results": [
    {
      "code": "종목코드",
      "name": "종목명",
      "action": "매수 또는 매도 또는 유지",
      "urgency": "긴급 또는 보통 또는 여유",
      "confidence": 80,
      "currentPrice": "현재가",
      "savedPrice": "사용자 매수가",
      "profitRate": "매수가 대비 수익률(%)",
      "shortReason": "한 줄 핵심 판단 근거 - 매수가 대비 손익 포함 (30자 이내)",
      "detailedReason": "왜 이 행동을 해야 하는지 상세 분석 (3~5줄, 매수가 대비 손익 상황 + 기술적/펀더멘탈 근거 포함, 초보자도 이해 가능하게)",
      "targetPrice": "목표 매도가 또는 추가 매수가 (추정)",
      "stopLoss": "손절가 (추정)"
    }
  ],
  "overallAdvice": "전체 포트폴리오 차원의 조언 (2~3줄)"
}
results의 순서는 urgency가 긴급한 것부터 정렬. confidence는 0~100 숫자.`;

    const response = await callGroq({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: '한국 주식 전문 트레이딩 어드바이저. 사용자의 투자 성향: 우량주(대형주, 시가총액 상위)는 장기 지속 매수(적립식) 전략, 성장주·소규모 회사는 단기 상승 차익 전략. 재무제표·펀더멘탈을 기본 반영하되, 현재 가격 트렌드와 모멘텀을 중심으로 판단. JSON만 답변.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2500,
    });

    const analysis = JSON.parse(response.data.choices[0].message.content);
    res.json({ stocks: enriched, analysis, checkedAt: getKSTTime() });
  } catch (e) {
    console.error('[/api/track-stocks]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── 매수/매도 알림 메일 발송 ──────────────────────────────────────────────────
app.post('/api/send-alert', async (req, res) => {
  try {
    const { stock } = req.body;
    if (!stock || !stock.code || !stock.action) {
      return res.status(400).json({ error: '종목 정보가 필요합니다.' });
    }
    const userEmail = req.user.email;
    const actionColor = stock.action === '매수' ? '#3b82f6' : '#ef4444';
    const actionEmoji = stock.action === '매수' ? '📈' : '📉';

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"InsightLedger AI" <${process.env.GMAIL_USER}>`,
      to: userEmail,
      subject: `[InsightLedger AI] ${actionEmoji} ${stock.name}(${stock.code}) ${stock.action} 신호`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f5f5f9;border-radius:12px;">
          <h2 style="color:#7c3aed;margin:0 0 8px;">InsightLedger AI</h2>
          <p style="color:#6b7280;margin:0 0 20px;">시세 추종 알림</p>
          <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e4e4ec;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
              <h3 style="margin:0;font-size:18px;">${stock.name} (${stock.code})</h3>
              <span style="background:${actionColor};color:#fff;padding:4px 14px;border-radius:20px;font-weight:700;font-size:14px;">${stock.action}</span>
            </div>
            <table style="width:100%;font-size:14px;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#6b7280;">현재가</td><td style="padding:6px 0;font-weight:600;text-align:right;">${stock.currentPrice}원</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">저장가</td><td style="padding:6px 0;text-align:right;">${stock.savedPrice}원</td></tr>
              <tr><td style="padding:6px 0;color:#6b7280;">확신도</td><td style="padding:6px 0;text-align:right;">${stock.confidence}%</td></tr>
              ${stock.targetPrice ? `<tr><td style="padding:6px 0;color:#6b7280;">목표가</td><td style="padding:6px 0;text-align:right;">${stock.targetPrice}</td></tr>` : ''}
              ${stock.stopLoss ? `<tr><td style="padding:6px 0;color:#6b7280;">손절가</td><td style="padding:6px 0;text-align:right;">${stock.stopLoss}</td></tr>` : ''}
            </table>
            <div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:6px;">
              <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">💡 ${stock.shortReason}</p>
            </div>
          </div>
          <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;text-align:center;">이 메일은 시세 추종 알림 설정에 의해 자동 발송되었습니다.</p>
        </div>
      `,
    });
    console.log(`[Alert] ${stock.action} 알림 발송: ${stock.name}(${stock.code}) → ${userEmail}`);
    res.json({ success: true });
  } catch (e) {
    console.error('[Alert] 알림 메일 발송 실패:', e.message);
    res.status(500).json({ error: '알림 메일 발송 실패' });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Stock Agent Server: http://localhost:${PORT}`);
});
