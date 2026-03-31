import { useState, useEffect } from 'react';
import axios from 'axios';

const METRICS = [
  {
    key: 'per',
    label: 'PER',
    unit: '배',
    desc: '주가수익비율(Price-Earnings Ratio): 주가 ÷ EPS. 같은 업종 내에서 낮을수록 저평가.',
    eval: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n) || n <= 0) return 'neutral';
      if (n < 10) return 'good';
      if (n < 20) return 'ok';
      return 'warn';
    },
    hint: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n) || n <= 0) return '해당없음(적자)';
      if (n < 10) return '저평가 구간';
      if (n < 15) return '적정 수준';
      if (n < 25) return '다소 고평가';
      return '고평가 주의';
    },
  },
  {
    key: 'pbr',
    label: 'PBR',
    unit: '배',
    desc: '주가순자산비율(Price-Book Ratio): 주가 ÷ BPS. 1배 미만이면 청산가치 이하.',
    eval: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n)) return 'neutral';
      return n < 1 ? 'good' : n < 2 ? 'ok' : 'warn';
    },
    hint: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n)) return '-';
      return n < 1 ? '순자산 이하(저평가)' : n < 2 ? '적정 수준' : '고평가 주의';
    },
  },
  {
    key: 'eps',
    label: 'EPS',
    unit: '원',
    desc: '주당순이익(Earnings Per Share): 순이익 ÷ 발행주식수. 높고 증가할수록 우수.',
    eval: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return n > 0 ? 'good' : 'warn';
    },
    hint: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return n > 0 ? '수익 창출 중' : '적자 기업 주의';
    },
  },
  {
    key: 'bps',
    label: 'BPS',
    unit: '원',
    desc: '주당순자산(Book Value Per Share): 순자산 ÷ 발행주식수. 청산가치의 기준.',
    eval: () => 'neutral',
    hint: () => '높을수록 자산가치 높음',
  },
  {
    key: 'roe',
    label: 'ROE',
    unit: '%',
    desc: '자기자본이익률(Return on Equity): 순이익 ÷ 자기자본. 15% 이상이 우수.',
    eval: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n)) return 'neutral';
      return n >= 15 ? 'good' : n >= 8 ? 'ok' : 'warn';
    },
    hint: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n)) return '-';
      return n >= 15 ? '우수한 수익성' : n >= 8 ? '평균 수준' : '수익성 낮음';
    },
  },
  {
    key: 'dividendYield',
    label: '배당수익률',
    unit: '%',
    desc: '주당배당금 ÷ 주가 × 100. 안정적인 현금흐름을 원하는 투자자에게 중요.',
    eval: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return n >= 3 ? 'good' : n > 0 ? 'ok' : 'neutral';
    },
    hint: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return n >= 3 ? '고배당주' : n > 0 ? '배당 지급' : '무배당';
    },
  },
  {
    key: 'estimatedPer',
    label: '추정PER',
    unit: '배',
    desc: '올해 예상 EPS 기준 PER. 현재 PER보다 낮으면 이익 성장 기대.',
    eval: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n) || n <= 0) return 'neutral';
      return n < 10 ? 'good' : n < 20 ? 'ok' : 'warn';
    },
    hint: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      if (isNaN(n) || n <= 0) return '-';
      return n < 10 ? '이익 성장 기대' : n < 20 ? '적정 수준' : '고평가 주의';
    },
  },
];

const EVAL_COLOR = {
  good: 'var(--green)',
  ok: 'var(--yellow)',
  warn: 'var(--red)',
  neutral: 'var(--subtext)',
};

function MetricCard({ cfg, value }) {
  const evalKey = cfg.eval(value);
  const hint = cfg.hint(value);
  const raw = String(value).replace(/[^0-9.-]/g, '');
  const num = Number(raw);
  const display = !isNaN(num) && num !== 0 ? num.toLocaleString() : String(value);

  return (
    <div className="metric-card">
      <div className="metric-header">
        <span className="metric-label">{cfg.label}</span>
        <span className="metric-eval-dot" style={{ background: EVAL_COLOR[evalKey] }} />
      </div>
      <div className="metric-value">
        {display}
        <span className="metric-unit"> {cfg.unit}</span>
      </div>
      <div className="metric-hint" style={{ color: EVAL_COLOR[evalKey] }}>{hint}</div>
      <div className="metric-desc">{cfg.desc}</div>
    </div>
  );
}

function formatMarketCap(v) {
  if (!v) return null;
  const n = Number(v);
  if (isNaN(n)) return String(v);
  if (n >= 1e12) return (n / 1e12).toFixed(1) + '조원';
  if (n >= 1e8)  return Math.round(n / 1e8).toLocaleString() + '억원';
  return n.toLocaleString() + '원';
}

function StockDetail({ code, name, onClose, onChartOpen }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError(null);
    axios.get(`/api/stockinfo?code=${code}`)
      .then(({ data }) => setInfo(data))
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [code]);

  if (!code) return null;

  const visibleMetrics = METRICS.filter(m => {
    const v = info?.[m.key];
    return v && v !== 'N/A' && v !== '-' && v !== 'null' && v !== null && v !== undefined;
  });

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="detail-header">
          <div className="detail-title">
            <span className="detail-name">{info?.name || name}</span>
            <span className="detail-code">{code}</span>
          </div>
          <div className="detail-header-actions">
            {onChartOpen && (
              <button
                className="btn-chart-mini"
                onClick={() => { onChartOpen(code, info?.name || name); onClose(); }}
                title="차트 보기"
              >
                📊 차트
              </button>
            )}
            <button className="chart-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {loading && (
          <div className="chart-loading">
            <div className="loader" />
            <p>지표 불러오는 중…</p>
          </div>
        )}

        {error && (
          <div className="error-box" style={{ margin: 16 }}>❌ {error}</div>
        )}

        {!loading && info && (
          <div className="detail-body">
            <div className="detail-price-row">
              {info.currentPrice && (
                <span className="detail-current-price">
                  {Number(String(info.currentPrice).replace(/,/g, '')).toLocaleString()}원
                </span>
              )}
              {info.changeRate != null && (
                <span className={parseFloat(info.changeRate) >= 0 ? 'text-red' : 'text-blue'}>
                  {parseFloat(info.changeRate) >= 0 ? '+' : ''}{info.changeRate}%
                </span>
              )}
              {info.marketCap && (
                <span className="detail-marketcap">시총 {formatMarketCap(info.marketCap)}</span>
              )}
            </div>

            {visibleMetrics.length > 0 ? (
              <div className="metrics-grid">
                {visibleMetrics.map(m => (
                  <MetricCard key={m.key} cfg={m} value={info[m.key]} />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--subtext)' }}>
                재무 지표 데이터를 가져오지 못했습니다
              </div>
            )}
            <div className="data-source">
              <span className="data-source-tag naver">📡 네이버 금융</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default StockDetail;
