import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const INTERVAL_MS = 10 * 60 * 1000; // 10분

function PriceTracker({ onChartOpen, onAnalyzeOpen }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [nextRefresh, setNextRefresh] = useState(null);
  const [alertCodes, setAlertCodes] = useState(() => JSON.parse(localStorage.getItem('stock_alert_codes') || '[]'));
  const [sentAlerts, setSentAlerts] = useState({});
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const getWatchlist = () => JSON.parse(localStorage.getItem('stock_watchlist') || '[]');

  const toggleAlert = (code) => {
    setAlertCodes(prev => {
      const next = prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code];
      localStorage.setItem('stock_alert_codes', JSON.stringify(next));
      return next;
    });
  };

  const fetchTracking = useCallback(async () => {
    const watchlist = getWatchlist();
    if (!watchlist.length) {
      setError('저장된 관심 종목이 없습니다. 종목 분석에서 ⭐ 저장 후 이용해주세요.');
      setResults(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.post('/api/track-stocks', {
        stocks: watchlist.map(s => ({
          code: s.code,
          name: s.name,
          price: s.price,
          strategy: s.strategy,
          reason: s.reason,
        })),
      }, { timeout: 60000 });
      setResults(data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 자동 새로고침 타이머
  useEffect(() => {
    if (autoEnabled) {
      const setNext = () => setNextRefresh(Date.now() + INTERVAL_MS);
      setNext();
      timerRef.current = setInterval(() => {
        fetchTracking();
        setNext();
      }, INTERVAL_MS);
      return () => clearInterval(timerRef.current);
    } else {
      setNextRefresh(null);
      clearInterval(timerRef.current);
    }
  }, [autoEnabled, fetchTracking]);

  // 카운트다운 표시
  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (!nextRefresh) { setCountdown(''); return; }
    countdownRef.current = setInterval(() => {
      const remain = Math.max(0, nextRefresh - Date.now());
      const min = Math.floor(remain / 60000);
      const sec = Math.floor((remain % 60000) / 1000);
      setCountdown(`${min}:${String(sec).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [nextRefresh]);

  // 매수/매도 의견인 종목에 대해 알림 메일 자동 발송
  useEffect(() => {
    if (!results?.analysis?.results) return;
    const toSend = results.analysis.results.filter(
      r => alertCodes.includes(r.code) && (r.action === '매수' || r.action === '매도') && !sentAlerts[r.code + '_' + r.action]
    );
    if (!toSend.length) return;
    toSend.forEach(async (r) => {
      try {
        await axios.post('/api/send-alert', {
          stock: { code: r.code, name: r.name, action: r.action, currentPrice: r.currentPrice, savedPrice: r.savedPrice, shortReason: r.shortReason, confidence: r.confidence, targetPrice: r.targetPrice, stopLoss: r.stopLoss },
        });
        setSentAlerts(prev => ({ ...prev, [r.code + '_' + r.action]: true }));
      } catch (e) {
        console.error('[Alert] 메일 발송 실패:', e.message);
      }
    });
  }, [results, alertCodes, sentAlerts]);

  const watchlist = getWatchlist();
  const analysis = results?.analysis;
  const actionResults = analysis?.results || [];

  const actionColor = (action) => {
    if (action === '매수') return 'tracker-buy';
    if (action === '매도') return 'tracker-sell';
    return 'tracker-hold';
  };

  const urgencyLabel = (u) => {
    if (u === '긴급') return '🔴 긴급';
    if (u === '보통') return '🟡 보통';
    return '🟢 여유';
  };

  const handleRemove = (code) => {
    const list = getWatchlist().filter(s => s.code !== code);
    localStorage.setItem('stock_watchlist', JSON.stringify(list));
    // re-fetch if we have results
    if (results) fetchTracking();
  };

  return (
    <div className="tracker-page">
      <section className="tracker-header">
        <div className="tracker-header-left">
          <h2 className="tracker-title">📡 오늘의 시세 추종</h2>
          <span className="tracker-subtitle">
            저장된 {watchlist.length}개 종목 · AI 매수/매도/유지 판단
          </span>
        </div>
        <div className="tracker-header-right">
          <label className="tracker-auto-toggle">
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={e => setAutoEnabled(e.target.checked)}
            />
            <span>자동 갱신 (10분)</span>
            {countdown && <span className="tracker-countdown">{countdown}</span>}
          </label>
          <button onClick={fetchTracking} disabled={loading} className="btn-analyze">
            {loading ? <><span className="spin">⟳</span> 분석 중…</> : '🔍 시세 체크'}
          </button>
        </div>
      </section>

      {error && <div className="error-box">❌ {error}</div>}

      {loading && (
        <div className="loading-box">
          <div className="loader" />
          <p>📡 {watchlist.length}개 종목 실시간 시세 수집 중...</p>
          <p>🧠 AI가 매수/매도/유지를 판단하고 있습니다.</p>
        </div>
      )}

      {!results && !loading && !error && (
        <div className="welcome-box">
          <div className="welcome-icon">📡</div>
          <h2>시세 추종을 시작해보세요</h2>
          <div className="welcome-features">
            <div className="welcome-feature">
              <span className="wf-icon">⭐</span>
              <div><strong>관심 종목 등록</strong><p>종목 분석에서 ⭐ 저장하면 자동 추가</p></div>
            </div>
            <div className="welcome-feature">
              <span className="wf-icon">📊</span>
              <div><strong>실시간 시세 체크</strong><p>현재가·등락률·거래량 자동 수집</p></div>
            </div>
            <div className="welcome-feature">
              <span className="wf-icon">🤖</span>
              <div><strong>AI 매매 판단</strong><p>매수·매도·유지 실시간 AI 분석</p></div>
            </div>
            <div className="welcome-feature">
              <span className="wf-icon">🔄</span>
              <div><strong>10분 자동 갱신</strong><p>자동 갱신으로 시세 변화 추적</p></div>
            </div>
          </div>
        </div>
      )}

      {results && !loading && (
        <>
          {/* 시장 요약 + 분석 시각 */}
          <div className="tracker-summary-bar">
            <div className="tracker-summary-left">
              <span className="tracker-checked-at">🕐 {results.checkedAt}</span>
              {analysis?.marketContext && (
                <span className="tracker-market-ctx">{analysis.marketContext}</span>
              )}
            </div>
          </div>

          {/* 종목별 카드 */}
          <div className="tracker-cards">
            {actionResults.map((r) => {
              const savedNum = parseInt(String(r.savedPrice).replace(/,/g, ''), 10) || 0;
              const curNum = parseInt(String(r.currentPrice).replace(/,/g, ''), 10) || 0;
              const pnl = savedNum > 0 ? (((curNum - savedNum) / savedNum) * 100).toFixed(2) : null;

              return (
                <div key={r.code} className={`tracker-card ${actionColor(r.action)}`}>
                  <div className="tracker-card-top">
                    <div className="tracker-card-name">
                      <strong>{r.name}</strong>
                      <span className="tracker-code">{r.code}</span>
                    </div>
                    <div className={`tracker-action-badge ${actionColor(r.action)}`}>
                      {r.action}
                    </div>
                  </div>

                  <div className="tracker-card-prices">
                    <div className="tracker-price-item">
                      <span className="tracker-price-label">현재가</span>
                      <span className="tracker-price-value">{Number(String(r.currentPrice).replace(/,/g, '')).toLocaleString()}원</span>
                    </div>
                    <div className="tracker-price-item">
                      <span className="tracker-price-label">저장가</span>
                      <span className="tracker-price-value dim">{Number(String(r.savedPrice).replace(/,/g, '')).toLocaleString()}원</span>
                    </div>
                    {pnl !== null && (
                      <div className="tracker-price-item">
                        <span className="tracker-price-label">수익률</span>
                        <span className={`tracker-price-value ${parseFloat(pnl) >= 0 ? 'up' : 'down'}`}>
                          {parseFloat(pnl) >= 0 ? '+' : ''}{pnl}%
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="tracker-card-meta">
                    <span className="tracker-urgency">{urgencyLabel(r.urgency)}</span>
                    <span className="tracker-confidence">확신도 {r.confidence}%</span>
                    {r.targetPrice && <span className="tracker-target">목표 {r.targetPrice}</span>}
                    {r.stopLoss && <span className="tracker-stoploss">손절 {r.stopLoss}</span>}
                  </div>

                  <p className="tracker-short-reason">{r.shortReason}</p>

                  <details className="tracker-detail">
                    <summary>상세 분석 보기</summary>
                    <p className="tracker-detailed-reason">{r.detailedReason}</p>
                  </details>

                  <div className="tracker-alert-toggle">
                    <label className="alert-switch">
                      <input
                        type="checkbox"
                        checked={alertCodes.includes(r.code)}
                        onChange={() => toggleAlert(r.code)}
                      />
                      <span className="alert-slider" />
                    </label>
                    <span className="alert-label">📧 매수/매도 알림</span>
                    {sentAlerts[r.code + '_' + r.action] && (r.action === '매수' || r.action === '매도') && (
                      <span className="alert-sent-badge">✓ 발송됨</span>
                    )}
                  </div>

                  <div className="tracker-card-actions">
                    <button className="tracker-btn" onClick={() => onChartOpen?.(r.code, r.name)}>📊 차트</button>
                    <button className="tracker-btn" onClick={() => onAnalyzeOpen?.({
                      code: r.code, name: r.name,
                      currentPrice: r.currentPrice,
                      reason: r.shortReason,
                      strategy: '-', riskLevel: '-', targetReturn: '-',
                    })}>🔍 상세분석</button>
                    <button className="tracker-btn danger" onClick={() => handleRemove(r.code)}>✕ 삭제</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 전체 포트폴리오 조언 */}
          {analysis?.overallAdvice && (
            <div className="tracker-overall">
              <h4>💡 포트폴리오 종합 조언</h4>
              <p>{analysis.overallAdvice}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PriceTracker;
