import { useState, useEffect } from 'react';
import axios from 'axios';

const VERDICT_COLOR = {
  '좋음': 'var(--green)',
  '보통': 'var(--yellow)',
  '주의': 'var(--red)',
};
const VERDICT_ICON = { '좋음': '✅', '보통': '🟡', '주의': '⚠️' };

const riskColor   = { '낮음': 'green', '중간': 'yellow', '높음': 'red' };
const stratIcon   = { '단기': '⚡', '중기': '📅', '장기': '🏦' };

const METRIC_FULLNAME = {
  'PER':           'Price Earnings Ratio',
  '추정PER':       'Estimated PER',
  'EPS':           'Earnings Per Share',
  '추정EPS':       'Estimated EPS',
  'PBR':           'Price Book-value Ratio',
  'BPS':           'Book-value Per Share',
  'ROE':           'Return On Equity',
  'ROA':           'Return On Assets',
  'EV/EBITDA':     'Enterprise Value / EBITDA',
  'EBITDA':        'Earnings Before Interest, Taxes, Depreciation & Amortization',
  '배당수익률':    'Dividend Yield',
  'DPS':           'Dividend Per Share',
  '부채비율':      'Debt-to-Equity Ratio',
  '유보율':        'Retention Ratio',
  '영업이익률':    'Operating Profit Margin',
  '순이익률':      'Net Profit Margin',
  '매출성장률':    'Revenue Growth Rate',
};

function MetricRow({ m }) {
  const color = VERDICT_COLOR[m.verdict] || 'var(--subtext)';
  const fullName = METRIC_FULLNAME[m.metric];
  return (
    <div className="sa-metric-row">
      <div className="sa-metric-left">
        <div className="sa-metric-name-wrap">
          <span className="sa-metric-name">{m.metric}</span>
          {fullName && <span className="sa-metric-fullname">{fullName}</span>}
        </div>
        <span className="sa-metric-value">{m.value}</span>
      </div>
      <div className="sa-metric-right">
        <span className="sa-verdict-icon">{VERDICT_ICON[m.verdict] || '•'}</span>
        <div className="sa-metric-texts">
          <p className="sa-easy-explain">{m.easyExplain}</p>
          <p className="sa-verdict-reason" style={{ color }}>{m.verdictReason}</p>
        </div>
      </div>
    </div>
  );
}

function StockAnalysis({ rec, onClose, onChartOpen, onSave }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [saved, setSaved] = useState(false);
  const [customPrice, setCustomPrice] = useState('');
  const [buyDate, setBuyDate] = useState(new Date().toISOString().slice(0, 10));
  const [finData, setFinData] = useState(null);
  const [finLoading, setFinLoading] = useState(false);
  const [finTab, setFinTab] = useState('annual'); // 'annual' | 'quarter'
  const [finAnalysis, setFinAnalysis] = useState(null);
  const [finAnalyzing, setFinAnalyzing] = useState(false);

  useEffect(() => {
    if (!rec?.code) {
      setState({ loading: false, error: '종목 코드가 없습니다.', data: null });
      return;
    }
    // 저장 여부 체크
    const watchlist = JSON.parse(localStorage.getItem('stock_watchlist') || '[]');
    setSaved(watchlist.some(s => s.code === rec.code));

    let cancelled = false;

    // 순차 실행: analyze-stock → financial-statements → analyze-financials
    // Groq API 429 방지를 위해 직렬 처리
    (async () => {
      // 1) 종목 심층 분석
      setState({ loading: true, error: null, data: null });
      try {
        const { data } = await axios.get('/api/analyze-stock', {
          timeout: 60000,
          params: {
            code: rec.code,
            name: rec.name,
            reason: rec.reason,
            strategy: rec.strategy,
            riskLevel: rec.riskLevel,
            targetReturn: rec.targetReturn,
          }
        });
        if (!cancelled) setState({ loading: false, error: null, data });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.response?.data?.error || e.message, data: null });
      }

      // 2) 재무제표 데이터 로드
      if (!cancelled) {
        setFinLoading(true);
        setFinData(null);
        setFinAnalysis(null);
        setFinAnalyzing(false);
      }
      try {
        const { data } = await axios.get('/api/financial-statements', {
          timeout: 10000,
          params: { code: rec.code },
        });
        if (cancelled) return;
        setFinData(data);
        setFinLoading(false);

        // 3) 재무제표 AI 분석 (analyze-stock 완료 후 실행)
        if (data && (data.annual || data.quarter)) {
          setFinAnalyzing(true);
          try {
            const { data: result } = await axios.post('/api/analyze-financials', {
              code: rec.code,
              name: rec.name,
              annual: data.annual,
              quarter: data.quarter,
              summary: data.summary,
            }, { timeout: 60000 });
            if (!cancelled) setFinAnalysis(result.analysis);
          } catch {
            if (!cancelled) setFinAnalysis(null);
          } finally {
            if (!cancelled) setFinAnalyzing(false);
          }
        }
      } catch {
        if (!cancelled) setFinData(null);
      } finally {
        if (!cancelled) setFinLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [rec?.code]);

  const handleSave = () => {
    const watchlist = JSON.parse(localStorage.getItem('stock_watchlist') || '[]');
    if (watchlist.some(s => s.code === rec.code)) return;
    const savePrice = customPrice && String(customPrice).trim()
      ? String(customPrice).trim().replace(/[^0-9]/g, '')
      : rec.currentPrice;
    watchlist.unshift({
      code: rec.code,
      name: rec.name,
      savedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      buyDate: buyDate,
      price: savePrice,
      changeRate: rec.changeRate,
      strategy: rec.strategy,
      riskLevel: rec.riskLevel,
      targetReturn: rec.targetReturn,
      reason: rec.reason,
    });
    localStorage.setItem('stock_watchlist', JSON.stringify(watchlist.slice(0, 100)));
    setSaved(true);
    onSave?.();
  };

  const handleUnsave = () => {
    const watchlist = JSON.parse(localStorage.getItem('stock_watchlist') || '[]');
    const filtered = watchlist.filter(s => s.code !== rec.code);
    localStorage.setItem('stock_watchlist', JSON.stringify(filtered));
    setSaved(false);
  };

  const { loading, error, data } = state;
  const a = data?.analysis;
  const priceNum = rec?.currentPrice
    ? parseInt(String(rec.currentPrice).replace(/,/g, ''), 10)
    : null;

  return (
    <div className="sa-overlay" onClick={onClose}>
      <div className="sa-modal" onClick={e => e.stopPropagation()}>

        {/* ─── 헤더 ─── */}
        <div className="sa-header">
          <div className="sa-header-top">
            <div className="sa-header-info">
              <div className="sa-title-row">
                <span className="sa-name">{rec?.name}</span>
                {rec?.code && <span className="detail-code">{rec.code}</span>}
                {rec?.market && <span className="rec-market">{rec.market}</span>}
              </div>
              <div className="sa-price-row">
                {priceNum && !isNaN(priceNum) && (
                  <span className="sa-price">{priceNum.toLocaleString()}원</span>
                )}
                {rec?.changeRate && (
                  <span className={rec.changeRate.toString().startsWith('-') ? 'text-blue' : 'text-red'}>
                    {rec.changeRate}
                  </span>
                )}
                <span className={`tag risk-${riskColor[rec?.riskLevel] || 'yellow'}`} style={{ marginLeft: 8 }}>
                  리스크: {rec?.riskLevel}
                </span>
                <span className="tag" style={{ marginLeft: 4 }}>
                  {stratIcon[rec?.strategy] || '📈'} {rec?.strategy}
                </span>
                {rec?.targetReturn && (
                  <span className="tag text-green" style={{ marginLeft: 4 }}>
                    목표: {rec.targetReturn}
                  </span>
                )}
              </div>
            </div>
            <div className="sa-header-btns">
              <button
                className={`btn-sa-save ${saved ? 'saved' : ''}`}
                onClick={saved ? handleUnsave : handleSave}
                title={saved ? '저장 취소' : '관심종목 저장'}
              >
                {saved ? '⭐ 저장됨' : '☆ 저장'}
              </button>
              {rec?.code && onChartOpen && (
                <button
                  className="btn-chart-mini"
                  style={{ padding: '5px 10px', fontSize: '0.82rem' }}
                  onClick={() => { onChartOpen(rec.code, rec.name); onClose(); }}
                  title="차트 보기"
                >
                  📊 차트
                </button>
              )}
              <button className="chart-close-btn" onClick={onClose}>✕</button>
            </div>
          </div>
          {!saved && (
            <div className="sa-save-fields" onClick={e => e.stopPropagation()}>
              <div className="sa-save-price">
                <label className="sa-price-input-label" htmlFor={`price-${rec?.code}`}>매수가</label>
                <input
                  id={`price-${rec?.code}`}
                  type="number"
                  inputMode="numeric"
                  className="sa-price-input"
                  placeholder={rec?.currentPrice ? String(rec.currentPrice).replace(/,/g, '') : '기준가'}
                  value={customPrice}
                  onChange={e => setCustomPrice(e.target.value)}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); e.target.focus(); }}
                  autoComplete="off"
                />
                <span className="sa-price-unit">원</span>
              </div>
              <div className="sa-save-date">
                <label className="sa-price-input-label" htmlFor={`date-${rec?.code}`}>매수일</label>
                <input
                  id={`date-${rec?.code}`}
                  type="date"
                  className="sa-date-input"
                  value={buyDate}
                  onChange={e => setBuyDate(e.target.value)}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); e.target.focus(); }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ─── 로딩 ─── */}
        {loading && (
          <div className="sa-loading">
            <div className="loader" />
            <p>🧠 AI가 종목을 분석하고 있습니다…</p>
            <p className="sa-loading-sub">재무지표 수집 + AI 해석 중 (약 5~10초)</p>
          </div>
        )}

        {/* ─── 에러 ─── */}
        {error && (
          <div className="error-box" style={{ margin: 20 }}>❌ {error}</div>
        )}

        {/* ─── 본문 ─── */}
        {!loading && a && (
          <div className="sa-body">

            {/* 핵심 요약 */}
            {a.summary && (
              <div className="sa-summary-box">
                <span className="sa-summary-icon">💡</span>
                <p className="sa-summary-text">{a.summary}</p>
              </div>
            )}

            {/* 기업 개요 카드 */}
            {(a.businessOverview || a.technology || a.marketPosition) && (
              <div className="sa-info-grid">
                {a.businessOverview && (
                  <div className="sa-info-card">
                    <div className="sa-info-card-header">
                      <span className="sa-info-card-icon">🏢</span>
                      <span className="sa-info-card-title">주요 비즈니스</span>
                    </div>
                    <p className="sa-info-card-text">{typeof a.businessOverview === 'string' ? a.businessOverview : JSON.stringify(a.businessOverview)}</p>
                  </div>
                )}
                {a.technology && (
                  <div className="sa-info-card">
                    <div className="sa-info-card-header">
                      <span className="sa-info-card-icon">⚙️</span>
                      <span className="sa-info-card-title">핵심 기술 역량</span>
                    </div>
                    <p className="sa-info-card-text">{typeof a.technology === 'string' ? a.technology : JSON.stringify(a.technology)}</p>
                  </div>
                )}
                {a.marketPosition && (
                  <div className="sa-info-card">
                    <div className="sa-info-card-header">
                      <span className="sa-info-card-icon">📡</span>
                      <span className="sa-info-card-title">시장에서의 평가</span>
                    </div>
                    <p className="sa-info-card-text">{typeof a.marketPosition === 'string' ? a.marketPosition : JSON.stringify(a.marketPosition)}</p>
                  </div>
                )}
              </div>
            )}

            {/* 섹터 경쟁사 */}
            {a.competitors?.length > 0 && (
              <div className="sa-section">
                <h3 className="sa-section-title">🏁 섹터 경쟁사</h3>
                <div className="sa-competitors">
                  {a.competitors.map((c, i) => (
                    <div className="sa-competitor-item" key={i}>
                      <span className="sa-competitor-name">{c.name}</span>
                      <span className="sa-competitor-region">{c.region}</span>
                      <span className="sa-competitor-note">{c.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 최근 주요 이슈 & 하이라이트 */}
            {a.recentHighlights?.length > 0 && (
              <div className="sa-section">
                <h3 className="sa-section-title">📰 최근 주요 이슈 & 기술 하이라이트</h3>
                <ul className="sa-highlights-list">
                  {a.recentHighlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI가 선정한 이유 */}
            {a.whySelected && (
              <div className="sa-why-box">
                <div className="sa-why-header">
                  <span>🤖</span>
                  <span>AI가 이 종목을 선정한 이유</span>
                </div>
                <p className="sa-why-text">{a.whySelected}</p>
              </div>
            )}

            {/* 재무지표 분석 */}
            {a.metricAnalysis?.length > 0 && (
              <div className="sa-section">
                <h3 className="sa-section-title">📊 주요 재무지표 분석</h3>
                <div className="sa-metrics-list">
                  {(Array.isArray(a.metricAnalysis) ? a.metricAnalysis.flat() : []).map((m, i) => (
                    m && typeof m === 'object' && m.metric ? <MetricRow key={i} m={m} /> : null
                  ))}
                </div>
              </div>
            )}

            {/* ─── 재무제표 ─── */}
            {(finData || finLoading) && (
              <div className="sa-section">
                <h3 className="sa-section-title">📑 재무제표</h3>
                {finLoading && (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--subtext)' }}>
                    <span className="spin">⟳</span> 재무제표 로딩 중...
                  </div>
                )}
                {finData && (
                  <>
                    {/* 기업 개요 */}
                    {finData.summary && (
                      <div className="fs-summary">
                        {[finData.summary.comment1, finData.summary.comment2, finData.summary.comment3]
                          .filter(Boolean).map((c, i) => <p key={i}>{c}</p>)}
                      </div>
                    )}

                    {/* 연간/분기 탭 */}
                    <div className="fs-tabs">
                      <button
                        className={`fs-tab ${finTab === 'annual' ? 'active' : ''}`}
                        onClick={() => setFinTab('annual')}
                      >
                        연간
                      </button>
                      <button
                        className={`fs-tab ${finTab === 'quarter' ? 'active' : ''}`}
                        onClick={() => setFinTab('quarter')}
                      >
                        분기
                      </button>
                    </div>

                    {/* 테이블 */}
                    {(() => {
                      const sheet = finTab === 'annual' ? finData.annual : finData.quarter;
                      if (!sheet) return <p style={{ color: 'var(--subtext)', textAlign: 'center', padding: 16 }}>데이터 없음</p>;
                      return (
                        <div className="fs-table-wrap">
                          <table className="fs-table">
                            <thead>
                              <tr>
                                <th className="fs-th-label">항목</th>
                                {sheet.periods.map(p => (
                                  <th key={p.key} className={p.isEstimate ? 'fs-est' : ''}>
                                    {p.title}{p.isEstimate && <span className="fs-est-badge">E</span>}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sheet.rows.map((row, i) => {
                                const isRatio = /률$|율$|ROE|PER|PBR/.test(row.title);
                                return (
                                  <tr key={i} className={isRatio ? 'fs-ratio-row' : ''}>
                                    <td className="fs-row-label">{row.title}</td>
                                    {row.values.map((v, j) => {
                                      const numStr = v.value.replace(/,/g, '');
                                      const num = parseFloat(numStr);
                                      const isNeg = !isNaN(num) && num < 0;
                                      const isPos = !isNaN(num) && num > 0 && isRatio;
                                      return (
                                        <td key={j} className={`fs-cell ${isNeg ? 'text-blue' : ''} ${isPos ? 'text-red' : ''}`}>
                                          {v.value}
                                          {isRatio && v.value !== '-' ? (row.title.includes('EPS') || row.title.includes('BPS') ? '원' : /PER|PBR/.test(row.title) ? '배' : '%') : ''}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                    <p className="fs-unit-note">※ 단위: 억원 (EPS/BPS: 원, 비율: %, PER/PBR: 배) | (E)는 컨센서스 추정치</p>
                    <div className="data-source">
                      <span className="data-source-tag naver">📡 네이버 금융</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ─── 재무제표 AI 분석 ─── */}
            {(finAnalysis || finAnalyzing) && (
              <div className="sa-section">
                <h3 className="sa-section-title">🧠 AI 재무제표 분석</h3>
                {finAnalyzing && (
                  <div style={{ textAlign: 'center', padding: 20, color: 'var(--subtext)' }}>
                    <span className="spin">⟳</span> AI가 재무제표를 분석하고 있습니다…
                  </div>
                )}
                {finAnalysis && (
                  <div className="fin-ai-result">
                    {/* 종합 등급 */}
                    <div className="fin-ai-grade-bar">
                      <span className={`fin-ai-grade fin-grade-${finAnalysis.overallGrade?.replace('+', 'p')}`}>
                        {finAnalysis.overallGrade}
                      </span>
                      <span className="fin-ai-grade-comment">{finAnalysis.overallComment}</span>
                    </div>

                    {/* 분석 카드 그리드 */}
                    <div className="fin-ai-cards">
                      {[
                        { key: 'profitability', icon: '💰', label: '수익성' },
                        { key: 'growth', icon: '📈', label: '성장성' },
                        { key: 'stability', icon: '🛡️', label: '안정성' },
                        { key: 'efficiency', icon: '⚡', label: '효율성' },
                        { key: 'quarterTrend', icon: '📊', label: '분기 추이' },
                      ].map(({ key, icon, label }) => {
                        const item = finAnalysis[key];
                        if (!item) return null;
                        const gradeClass = item.grade === '좋음' ? 'good' : item.grade === '보통' ? 'normal' : 'warn';
                        return (
                          <div className={`fin-ai-card fin-ai-card-${gradeClass}`} key={key}>
                            <div className="fin-ai-card-header">
                              <span className="fin-ai-card-icon">{icon}</span>
                              <span className="fin-ai-card-label">{label}</span>
                              <span className={`fin-ai-card-grade fin-badge-${gradeClass}`}>{item.grade}</span>
                            </div>
                            <p className="fin-ai-card-text">{item.analysis}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* 투자 의견 */}
                    {finAnalysis.investmentOpinion && (
                      <div className="fin-ai-opinion">
                        <h4>📋 종합 투자 의견</h4>
                        <p>{finAnalysis.investmentOpinion}</p>
                      </div>
                    )}

                    {/* 강점 & 리스크 */}
                    <div className="fin-ai-two-col">
                      {finAnalysis.keyStrengths?.length > 0 && (
                        <div className="fin-ai-strengths">
                          <h4>✅ 재무적 강점</h4>
                          <ul>
                            {finAnalysis.keyStrengths.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}
                      {finAnalysis.keyRisks?.length > 0 && (
                        <div className="fin-ai-risks">
                          <h4>⚠️ 재무적 리스크</h4>
                          <ul>
                            {finAnalysis.keyRisks.map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="data-source">
                      <span className="data-source-tag naver">📡 네이버 금융</span>
                      <span className="data-source-tag ai">🧠 Groq AI (llama-3.1-8b)</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 투자 포인트 & 주의사항 */}
            {(a.investmentPoints?.length > 0 || a.warnings?.length > 0) && (
              <div className="sa-two-col">
                {a.investmentPoints?.length > 0 && (
                  <div className="sa-col-card sa-col-points">
                    <h3 className="sa-col-title">🎯 핵심 투자 포인트</h3>
                    <ul>
                      {a.investmentPoints.map((p, i) => (
                        <li key={i}>{typeof p === 'string' ? p : JSON.stringify(p)}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {a.warnings?.length > 0 && (
                  <div className="sa-col-card sa-col-warns">
                    <h3 className="sa-col-title">⚠️ 주의할 점</h3>
                    <ul>
                      {a.warnings.map((w, i) => (
                        <li key={i}>{typeof w === 'string' ? w : JSON.stringify(w)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* 초보자 팁 */}
            {a.beginnerTip && (
              <div className="sa-tip-box">
                <span>🌱 초보 투자자 팁</span>
                <p>{a.beginnerTip}</p>
              </div>
            )}

            <div className="data-source">
              <span className="data-source-tag naver">📡 네이버 금융</span>
              <span className="data-source-tag ai">🤖 Groq AI (llama-3.1-8b)</span>
            </div>
            <p className="sa-disclaimer">
              ⚠️ 본 분석은 AI가 생성한 참고 자료이며, 투자 손실에 대한 책임을 지지 않습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default StockAnalysis;
