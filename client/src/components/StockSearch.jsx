import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

function StockSearch({ onChartOpen, onAnalyzeOpen }) {
  const [query, setQuery]           = useState('');
  const [searchResults, setSearchResults] = useState([]); // 검색 결과 목록
  const [loadingList, setLoadingList] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [info, setInfo]             = useState(null);
  const [error, setError]           = useState(null);
  const wrapRef                     = useRef(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoadingList(true);
    setError(null);
    setInfo(null);
    setSearchResults([]);
    try {
      const { data } = await axios.get(`/api/search?q=${encodeURIComponent(query.trim())}`);
      if (!data || data.length === 0) {
        setError('검색 결과가 없습니다. 다른 키워드를 입력해주세요.');
      } else {
        setSearchResults(data);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingList(false);
    }
  };

  const handleSelectResult = async (item) => {
    setLoadingInfo(true);
    setError(null);
    setInfo(null);
    setSearchResults([]);
    setQuery(item.name);
    try {
      const { data } = await axios.get('/api/stockinfo', {
        params: { code: item.code },
        timeout: 10000,
      });
      setInfo({ ...data, code: item.code, name: item.name });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch();
  };

  const priceNum = info?.currentPrice ? parseInt(String(info.currentPrice).replace(/,/g, ''), 10) : null;
  const rateNum  = info?.changeRate ? parseFloat(info.changeRate) : null;

  const formatNum = (v) => {
    if (!v) return null;
    const n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? v : n.toLocaleString();
  };

  return (
    <section className="section stock-search-section">
      <h2 className="section-title">🔎 종목 검색</h2>
      <p className="sector-desc">종목명 일부를 입력하면 포함된 모든 종목을 조회할 수 있습니다. (예: "삼성" → 삼성전자, 삼성SDI 등)</p>

      <div className="sector-controls">
        <div className="sector-search-wrap" ref={wrapRef}>
          <input
            className="sector-filter"
            type="text"
            placeholder="종목명 입력 (예: 삼성, SK, 카카오...)"
            value={query}
            onChange={e => { setQuery(e.target.value); setInfo(null); setSearchResults([]); setError(null); }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <button
          className="btn-sector"
          onClick={handleSearch}
          disabled={!query.trim() || loadingList || loadingInfo}
        >
          {loadingList ? <><span className="spin">⟳</span> 검색 중...</> : '🔍 종목 조회'}
        </button>
      </div>

      {error && <div className="error-box">❌ {error}</div>}

      {/* 검색 결과 목록 */}
      {searchResults.length > 0 && (
        <div className="stock-search-list">
          <p className="search-result-hint">총 {searchResults.length}개 종목 — 클릭하면 상세 정보를 조회합니다.</p>
          <ul className="search-result-list">
            {searchResults.map(s => (
              <li key={s.code} onClick={() => handleSelectResult(s)}>
                <span className="sr-name">{s.name}</span>
                <span className="sr-meta">
                  {s.market && <span className="rec-market" style={{marginRight:6}}>{s.market}</span>}
                  <span className="suggestion-code">{s.code}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loadingInfo && (
        <div className="loading-box">
          <div className="loader" />
          <p>📡 <strong>{query}</strong> 종목 정보 수집 중...</p>
        </div>
      )}

      {info && !loadingInfo && (
        <div className="stock-search-result">
          <div className="rec-card search-result-card">
            {/* 헤더 */}
            <div className="rec-header">
              <span className="rec-name">{info.name}</span>
              <span className="detail-code">{info.code}</span>
              {info.market && <span className="rec-market">{info.market}</span>}
              {info.code && (
                <button className="btn-chart-mini" onClick={() => onChartOpen?.(info.code, info.name)} title="차트 보기">
                  📊
                </button>
              )}
            </div>

            {/* 가격 행 */}
            <div className="rec-price">
              {priceNum && !isNaN(priceNum) && (
                <span>{priceNum.toLocaleString()}원</span>
              )}
              {rateNum !== null && (
                <span className={rateNum > 0 ? 'text-green' : rateNum < 0 ? 'text-red' : ''}>
                  {rateNum > 0 ? '+' : ''}{info.changeRate}%
                </span>
              )}
            </div>

            {/* 업종 */}
            {info.sector && (
              <p className="rec-reason">📂 업종: {info.sector}</p>
            )}

            {/* 시세 요약 그리드 */}
            <div className="ss-info-grid">
              {info.marketCap && (
                <div className="ss-info-item">
                  <span className="ss-info-label">시가총액</span>
                  <span className="ss-info-value">{info.marketCap}</span>
                </div>
              )}
              {info.volume && (
                <div className="ss-info-item">
                  <span className="ss-info-label">거래량</span>
                  <span className="ss-info-value">{formatNum(info.volume)}</span>
                </div>
              )}
              {info.high52w && (
                <div className="ss-info-item">
                  <span className="ss-info-label">52주 최고</span>
                  <span className="ss-info-value text-green">{formatNum(info.high52w)}원</span>
                </div>
              )}
              {info.low52w && (
                <div className="ss-info-item">
                  <span className="ss-info-label">52주 최저</span>
                  <span className="ss-info-value text-red">{formatNum(info.low52w)}원</span>
                </div>
              )}
              {info.foreignRate && (
                <div className="ss-info-item">
                  <span className="ss-info-label">외인소진율</span>
                  <span className="ss-info-value">{info.foreignRate}</span>
                </div>
              )}
              {info.tradingValue && (
                <div className="ss-info-item">
                  <span className="ss-info-label">거래대금</span>
                  <span className="ss-info-value">{info.tradingValue}</span>
                </div>
              )}
            </div>

            {/* 투자지표 요약 */}
            {(info.per || info.pbr || info.eps || info.dividendYield) && (
              <div className="ss-metrics-bar">
                {info.per && <span className="ss-metric">PER <strong>{info.per}배</strong></span>}
                {info.pbr && <span className="ss-metric">PBR <strong>{info.pbr}배</strong></span>}
                {info.eps && <span className="ss-metric">EPS <strong>{formatNum(info.eps)}원</strong></span>}
                {info.bps && <span className="ss-metric">BPS <strong>{formatNum(info.bps)}원</strong></span>}
                {info.dividendYield && <span className="ss-metric">배당 <strong>{info.dividendYield}%</strong></span>}
                {info.estimatedPer && <span className="ss-metric ss-est">추정PER <strong>{info.estimatedPer}배</strong></span>}
              </div>
            )}

            {/* 52주 가격 위치 바 */}
            {info.high52w && info.low52w && priceNum && (() => {
              const high = parseInt(String(info.high52w).replace(/,/g, ''), 10);
              const low  = parseInt(String(info.low52w).replace(/,/g, ''), 10);
              const pct  = high > low ? ((priceNum - low) / (high - low)) * 100 : 50;
              return (
                <div className="ss-range-bar-wrap">
                  <span className="ss-range-label">52주 범위</span>
                  <div className="ss-range-bar">
                    <div className="ss-range-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    <div className="ss-range-dot" style={{ left: `${Math.min(100, Math.max(0, pct))}%` }} />
                  </div>
                  <div className="ss-range-labels">
                    <span>{formatNum(info.low52w)}</span>
                    <span>{formatNum(info.high52w)}</span>
                  </div>
                </div>
              );
            })()}

            {/* 액션 */}
            <div className="rec-card-actions">
              <button
                className="btn-analyze-stock"
                onClick={() => onAnalyzeOpen?.({
                  code: info.code,
                  name: info.name,
                  currentPrice: info.currentPrice,
                  changeRate: info.changeRate,
                  reason: `검색 종목: ${info.name}`,
                  strategy: '중기',
                  riskLevel: '중간',
                  targetReturn: '분석 필요',
                })}
              >
                🔍 종목분석
              </button>
            </div>
            <div className="data-source">
              <span className="data-source-tag naver">📡 네이버 금융</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default StockSearch;
