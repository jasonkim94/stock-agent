import { useState, useEffect } from 'react';
import axios from 'axios';

function SectorAnalysis({ onChartOpen, onAnalyzeOpen }) {
  const [sectors, setSectors] = useState([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingSectors, setLoadingSectors] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get('/api/sectors')
      .then(({ data }) => setSectors(data))
      .catch(() => {})
      .finally(() => setLoadingSectors(false));
  }, []);

  const filtered = filter
    ? sectors.filter(s => s.name.includes(filter))
    : sectors;

  const handleSelect = (sector) => {
    setSelected(sector);
    setFilter(sector.name);
    setResult(null);
    setError(null);
  };

  const analyze = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await axios.get(
        `/api/sector?no=${selected.no}&name=${encodeURIComponent(selected.name)}`
      );
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const sentimentColor = {
    BULLISH: 'green', BEARISH: 'red', NEUTRAL: 'yellow'
  };
  const riskColor = { '낮음': 'green', '중간': 'yellow', '높음': 'red' };
  const strategyIcon = { '단기': '⚡', '중기': '📅', '장기': '🏦' };

  return (
    <section className="section sector-section">
      <h2 className="section-title">🔍 섹터별 종목 분석</h2>
      <p className="sector-desc">특정 업종(섹터)을 선택하면 AI가 해당 섹터 종목을 분석하고 추천 종목과 향후 전망을 제시합니다.</p>

      {/* 섹터 선택 컨트롤 */}
      <div className="sector-controls">
        <div className="sector-search-wrap">
          <input
            className="sector-filter"
            type="text"
            placeholder="섹터 검색 (예: 전기전자, 의약품...)"
            value={filter}
            onChange={e => { setFilter(e.target.value); setSelected(null); setResult(null); }}
          />
          {filter && filtered.length > 0 && !selected && (
            <ul className="sector-dropdown">
              {filtered.map(s => (
                <li key={s.no} onClick={() => handleSelect(s)}>
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          className="btn-sector"
          onClick={analyze}
          disabled={!selected || loading}
        >
          {loading ? <><span className="spin">⟳</span> 분석 중...</> : '🔬 섹터 분석'}
        </button>
      </div>

      {loadingSectors && <p className="sector-loading-hint">섹터 목록 로딩 중...</p>}

      {error && <div className="error-box">❌ 오류: {error}</div>}

      {loading && (
        <div className="loading-box">
          <div className="loader" />
          <p>📡 네이버 금융에서 <strong>{selected?.name}</strong> 섹터 종목 수집 중...</p>
          <p>🧠 AI가 섹터를 분석하고 있습니다.</p>
        </div>
      )}

      {result && !loading && (
        <div className="sector-result">
          {/* 헤더 */}
          <div className="sector-result-header">
            <span className={`sentiment-badge ${sentimentColor[result.analysis?.sentiment] || 'yellow'}`}>
              {result.analysis?.sentimentKo || result.analysis?.sentiment}
            </span>
            <span className="sector-result-name">{result.sectorName} 섹터</span>
            <span className="data-date">📅 {result.dataDate}</span>
          </div>

          {/* 섹터 전망 */}
          <div className="market-summary">
            <strong>섹터 전망</strong>
            <p style={{ marginTop: 8 }}>{result.analysis?.sectorOutlook}</p>
          </div>

          {/* 성장 동인 */}
          {result.analysis?.catalysts?.length > 0 && (
            <div className="catalyst-box">
              <h4>🚀 주요 성장 동인</h4>
              <ul>
                {result.analysis.catalysts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          {/* 섹터 종목 현황 */}
          <h3 className="sub-title">📋 {result.sectorName} 종목 현황 ({result.stocks?.length}개)</h3>
          <div className="table-wrapper">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>#</th><th>종목명</th><th>현재가</th><th>등락률</th>
                </tr>
              </thead>
              <tbody>
                {result.stocks?.map((s, i) => {
                  const rate = parseFloat(s.changeRate);
                  return (
                    <tr key={i}>
                      <td className="rank">{i + 1}</td>
                      <td className="stock-name">
                        {s.name}
                        {s.code && (
                          <button className="btn-chart-mini" onClick={() => onChartOpen?.(s.code, s.name)} title="차트 보기">
                            📊
                          </button>
                        )}
                      </td>
                      <td className="price">{Number(s.price).toLocaleString()}원</td>
                      <td className={`rate ${rate > 0 ? 'text-red' : rate < 0 ? 'text-blue' : ''}`}>
                        {s.changeRate}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* AI 추천 종목 */}
          <h3 className="sub-title">💡 AI 추천 종목 ({result.analysis?.recommendations?.length}개)</h3>
          <div className="rec-grid">
            {result.analysis?.recommendations?.map((rec, i) => {
              const priceNum = parseInt(String(rec.currentPrice).replace(/,/g, ''), 10);
              const targetNum = parseInt(String(rec.targetPrice).replace(/,/g, ''), 10);
              const upside = !isNaN(priceNum) && !isNaN(targetNum) && priceNum > 0
                ? (((targetNum - priceNum) / priceNum) * 100).toFixed(1)
                : null;
              return (
                <div className="rec-card sector-rec-card" key={i}>
                  <div className="rec-header">
                    <span className="rec-rank">#{rec.rank}</span>
                    <span className="rec-name">{rec.name}</span>
                    <span className={`tag risk-${riskColor[rec.riskLevel] || 'yellow'}`} style={{ marginLeft: 'auto' }}>
                      리스크:{rec.riskLevel}
                    </span>
                    {rec.code && (
                      <button className="btn-chart-mini" onClick={() => onChartOpen?.(rec.code, rec.name)} title="차트 보기">
                        📊
                      </button>
                    )}
                    {upside != null && (
                      <span className="rec-target">
                        목표가 {targetNum.toLocaleString()}원{' '}
                        <span className={parseFloat(upside) >= 0 ? 'text-red' : 'text-blue'}>
                          ({parseFloat(upside) >= 0 ? '+' : ''}{upside}%)
                        </span>
                      </span>
                    )}
                  </div>

                  <p className="rec-reason">{rec.reason}</p>

                  <div className="forecast-box">
                    <span className="forecast-label">📈 향후 전망</span>
                    <p>{rec.forecast}</p>
                  </div>

                  <div className="rec-tags">
                    <span className="tag">{strategyIcon[rec.strategy] || '📈'} {rec.strategy}</span>
                  </div>
                  {/* 카드 하단 액션 */}
                  <div className="rec-card-actions">
                    <button
                      className="btn-analyze-stock"
                      onClick={() => onAnalyzeOpen?.({
                        code: rec.code,
                        name: rec.name,
                        currentPrice: rec.currentPrice,
                        changeRate: rec.changeRate,
                        reason: rec.reason,
                        strategy: rec.strategy,
                        riskLevel: rec.riskLevel,
                        targetReturn: rec.targetReturn,
                      })}
                    >
                      🔍 종목분석
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 리스크 */}
          {result.analysis?.risks?.length > 0 && (
            <div className="cautions" style={{ marginTop: 20 }}>
              <h3>⚠️ 주요 리스크 요인</h3>
              <ul>
                {result.analysis.risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          <div className="data-source">
            <span className="data-source-tag naver">📡 네이버 금융</span>
            <span className="data-source-tag ai">🤖 Groq AI (llama-3.1-8b)</span>
          </div>
          <p className="disclaimer" style={{ marginTop: 16, fontSize: '0.75rem', color: 'var(--subtext)', textAlign: 'center' }}>
            {result.analysis?.disclaimer}
          </p>
        </div>
      )}
    </section>
  );
}

export default SectorAnalysis;
