import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts';

const PERIODS = [
  { key: 'day',   label: '일' },
  { key: 'week',  label: '주' },
  { key: 'month', label: '월' },
  { key: 'year',  label: '년' },
];

function formatDate(date, period) {
  if (!date) return '';
  const s = String(date);
  if (period === 'year')  return s;                                        // 2024
  if (period === 'month') return `${s.slice(2,4)}.${s.slice(4,6)}`;       // 24.03
  if (period === 'week')  return s.slice(2).replace('W', '/W');            // 25/W09
  if (period === 'day' && s.length >= 8)
    return `${s.slice(4,6)}.${s.slice(6,8)}`;                             // 03.20
  return s;
}

function formatDateFull(date, period) {
  if (!date) return '';
  const s = String(date);
  if (period === 'year')  return `${s}년`;
  if (period === 'month') return `${s.slice(0,4)}년 ${s.slice(4,6)}월`;
  if (period === 'week')  return `${s.slice(0,4)}년 ${s.slice(5)}주차`;
  if (s.length >= 8) return `${s.slice(0,4)}.${s.slice(4,6)}.${s.slice(6,8)}`;
  return s;
}

function formatPrice(v) {
  if (!v) return '';
  return Number(v).toLocaleString() + '원';
}

const CustomTooltip = ({ active, payload, label, period }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="chart-tooltip">
      <p className="tooltip-date">{formatDateFull(d?.date, period)}</p>
      {d?.open  != null && <p>시가: <span>{Number(d.open ).toLocaleString()}원</span></p>}
      {d?.high  != null && <p>고가: <span className="text-red">{Number(d.high ).toLocaleString()}원</span></p>}
      {d?.low   != null && <p>저가: <span className="text-blue">{Number(d.low  ).toLocaleString()}원</span></p>}
      {d?.close != null && <p>종가: <span style={{fontWeight:700}}>{Number(d.close).toLocaleString()}원</span></p>}
      {d?.volume != null && <p style={{color:'var(--subtext)',fontSize:'0.78rem'}}>거래량: {Number(d.volume).toLocaleString()}</p>}
    </div>
  );
};

function StockChart({ code, name, onClose }) {
  const [period, setPeriod] = useState('day');
  const [data, setData]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError(null);
    axios.get(`/api/chart?code=${code}&period=${period}`)
      .then(({ data: raw }) => {
        setData(raw.map(c => ({
          ...c,
          label: formatDate(c.date, period),
          change: c.close - c.open,
        })));
      })
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [code, period]);

  if (!code) return null;

  const prices = data.map(d => d.close).filter(Boolean);
  const minPrice = prices.length ? Math.min(...prices) * 0.995 : 0;
  const maxPrice = prices.length ? Math.max(...prices) * 1.005 : 0;
  const firstClose = data[0]?.close;

  return (
    <div className="chart-overlay" onClick={onClose}>
      <div className="chart-modal" onClick={e => e.stopPropagation()}>
        <div className="chart-modal-header">
          <div className="chart-title-wrap">
            <span className="chart-modal-name">{name}</span>
            <span className="chart-modal-code">{code}</span>
          </div>
          <div className="chart-period-tabs">
            {PERIODS.map(p => (
              <button
                key={p.key}
                className={`period-tab ${period === p.key ? 'active' : ''}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button className="chart-close-btn" onClick={onClose}>✕</button>
        </div>

        {loading && (
          <div className="chart-loading">
            <div className="loader" />
            <p>차트 데이터 로딩 중...</p>
          </div>
        )}
        {error && <div className="error-box" style={{margin:'16px'}}>❌ {error}</div>}

        {!loading && !error && data.length > 0 && (
          <div className="chart-body">
            {/* 가격 차트 */}
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={data} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#888', fontSize: 11 }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[minPrice, maxPrice]}
                  tickFormatter={v => Number(v).toLocaleString()}
                  tick={{ fill: '#888', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                />
                <Tooltip content={<CustomTooltip period={period} />} />
                {firstClose && (
                  <ReferenceLine y={firstClose} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                )}
                <Line
                  type="monotone"
                  dataKey="close"
                  stroke="#4cc9f0"
                  strokeWidth={2}
                  dot={data.length <= 30}
                  activeDot={{ r: 5, fill: '#4cc9f0' }}
                  name="종가"
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* 거래량 차트 */}
            <ResponsiveContainer width="100%" height={90}>
              <ComposedChart data={data} margin={{ top: 0, right: 12, left: 12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="label" hide />
                <YAxis
                  tickFormatter={v => v >= 1e6 ? (v/1e6).toFixed(0)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v}
                  tick={{ fill: '#888', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                />
                <Tooltip
                  formatter={(v) => [Number(v).toLocaleString(), '거래량']}
                  labelFormatter={l => l}
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--subtext)', fontSize: '0.8rem' }}
                />
                <Bar
                  dataKey="volume"
                  fill="rgba(167,139,250,0.45)"
                  radius={[2, 2, 0, 0]}
                  name="거래량"
                />
              </ComposedChart>
            </ResponsiveContainer>

            {/* 요약 */}
            <div className="chart-summary">
              {data.length > 0 && (() => {
                const last = data[data.length - 1];
                const first = data[0];
                const diff = last.close - first.close;
                const pct = first.close ? ((diff / first.close) * 100).toFixed(2) : 0;
                return (
                  <>
                    <span>현재가 <strong>{Number(last.close).toLocaleString()}원</strong></span>
                    <span className={diff >= 0 ? 'text-red' : 'text-blue'}>
                      {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toLocaleString()}원 ({diff >= 0 ? '+' : ''}{pct}%)
                    </span>
                    <span className="summary-period">{PERIODS.find(p=>p.key===period)?.label}봉 {data.length}개</span>
                  </>
                );
              })()}
            </div>
            <div className="data-source">
              <span className="data-source-tag naver">📡 네이버 금융</span>
            </div>
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <p style={{ color: 'var(--subtext)', textAlign: 'center', padding: '40px' }}>
            차트 데이터가 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}

export default StockChart;
