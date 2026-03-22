import { useState, useEffect, useMemo } from 'react';

const SENT_COLOR = { BULLISH: 'green', BEARISH: 'red', NEUTRAL: 'yellow' };

function HistoryPage({ onDetailOpen, onChartOpen }) {
  const [history, setHistory] = useState([]);
  const [view, setView] = useState('list'); // 'list' | 'trend'
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const h = JSON.parse(localStorage.getItem('stock_ai_history') || '[]');
    setHistory(h);
  }, []);

  const trendData = useMemo(() => {
    const map = {};
    history.forEach(entry => {
      (entry.recommendations || []).forEach(rec => {
        const key = rec.code || rec.name;
        if (!map[key]) map[key] = { name: rec.name, code: rec.code || '', appearances: [] };
        map[key].appearances.push({
          savedAt: entry.savedAt,
          rank: rec.rank,
          price: rec.currentPrice,
          changeRate: rec.changeRate,
        });
      });
    });
    return Object.values(map).sort((a, b) => b.appearances.length - a.appearances.length);
  }, [history]);

  const deleteEntry = (id) => {
    const next = history.filter(e => e.id !== id);
    setHistory(next);
    localStorage.setItem('stock_ai_history', JSON.stringify(next));
  };

  const clearAll = () => {
    if (!window.confirm('모든 이력을 삭제하시겠습니까?')) return;
    setHistory([]);
    localStorage.removeItem('stock_ai_history');
  };

  return (
    <section className="section history-section">
      <div className="section-header">
        <h2 className="section-title">📁 분석 이력 ({history.length}건)</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="history-view-tabs">
            <button
              className={`htab ${view === 'list' ? 'active' : ''}`}
              onClick={() => setView('list')}
            >
              목록
            </button>
            <button
              className={`htab ${view === 'trend' ? 'active' : ''}`}
              onClick={() => setView('trend')}
            >
              반복 종목
            </button>
          </div>
          {history.length > 0 && (
            <button className="btn-delete-all" onClick={clearAll}>🗑 전체삭제</button>
          )}
        </div>
      </div>

      <div className="data-source">
        <span className="data-source-tag local">💾 로컬 저장소 (localStorage)</span>
      </div>

      {history.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--subtext)' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 16 }}>🗂</div>
          <p>저장된 분석 내역이 없습니다</p>
          <p style={{ fontSize: '0.85rem', marginTop: 8 }}>
            메인 화면에서 AI 분석 후 "💾 저장" 버튼을 클릭하세요
          </p>
        </div>
      )}

      {view === 'list' && history.map(entry => (
        <div className="history-card" key={entry.id}>
          <div className="history-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className={`sentiment-badge ${SENT_COLOR[entry.sentiment] || 'yellow'}`}>
                {entry.sentimentKo || entry.sentiment}
              </span>
              <span className="history-date">{entry.savedAt}</span>
            </div>
            <button
              className="btn-icon-delete"
              onClick={() => deleteEntry(entry.id)}
              title="삭제"
            >
              🗑
            </button>
          </div>

          {entry.marketSummary && (
            <p className="history-summary">
              {entry.marketSummary.length > 120
                ? entry.marketSummary.slice(0, 120) + '…'
                : entry.marketSummary}
            </p>
          )}

          <div className="history-chips">
            {(entry.recommendations || []).slice(0, 5).map((rec, i) => (
              <span key={i} className="history-chip">
                #{rec.rank} {rec.name}
                {rec.changeRate && (
                  <span className={rec.changeRate.startsWith('+') ? 'text-green' : 'text-red'}>
                    {' '}{rec.changeRate}
                  </span>
                )}
              </span>
            ))}
          </div>

          <button
            className="btn-expand"
            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
          >
            {expanded === entry.id ? '▲ 접기' : '▼ 상세 보기'}
          </button>

          {expanded === entry.id && (
            <div className="history-detail-table">
              {(entry.recommendations || []).map((rec, i) => (
                <div key={i} className="history-rec-row">
                  <span className="rec-rank">#{rec.rank}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{rec.name}</span>
                  {rec.code && (
                    <span className="detail-code">{rec.code}</span>
                  )}
                  <span style={{ fontSize: '0.85rem' }}>
                    {rec.currentPrice
                      ? Number(String(rec.currentPrice).replace(/,/g, '')).toLocaleString() + '원'
                      : ''}
                  </span>
                  {rec.changeRate && (
                    <span className={rec.changeRate.startsWith('+') ? 'text-green' : 'text-red'}>
                      {rec.changeRate}
                    </span>
                  )}
                  <span className="tag">{rec.strategy}</span>
                  <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
                    {rec.code && onDetailOpen && (
                      <button
                        className="btn-chart-mini"
                        onClick={() => onDetailOpen(rec.code, rec.name)}
                        title="상세 지표"
                      >
                        📋
                      </button>
                    )}
                    {rec.code && onChartOpen && (
                      <button
                        className="btn-chart-mini"
                        onClick={() => onChartOpen(rec.code, rec.name)}
                        title="차트 보기"
                      >
                        📊
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {view === 'trend' && (
        <div className="trend-list">
          {trendData.length === 0 && (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--subtext)' }}>
              저장된 이력이 없습니다
            </div>
          )}
          {trendData.map((stock, i) => (
            <div className="trend-card" key={i}>
              <div className="trend-header">
                <span className="trend-name">{stock.name}</span>
                {stock.code && <span className="detail-code">{stock.code}</span>}
                <span className="trend-count">🔁 {stock.appearances.length}회 추천</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                  {stock.code && onDetailOpen && (
                    <button
                      className="btn-chart-mini"
                      onClick={() => onDetailOpen(stock.code, stock.name)}
                      title="상세"
                    >
                      📋
                    </button>
                  )}
                  {stock.code && onChartOpen && (
                    <button
                      className="btn-chart-mini"
                      onClick={() => onChartOpen(stock.code, stock.name)}
                      title="차트"
                    >
                      📊
                    </button>
                  )}
                </div>
              </div>
              <div className="trend-appearances">
                {stock.appearances.map((a, j) => (
                  <div key={j} className="trend-row">
                    <span className="trend-date">
                      {a.savedAt ? a.savedAt.split(' ').slice(0, 3).join(' ') : ''}
                    </span>
                    <span className="tag">#{a.rank}위</span>
                    <span>
                      {a.price
                        ? Number(String(a.price).replace(/,/g, '')).toLocaleString() + '원'
                        : ''}
                    </span>
                    {a.changeRate && (
                      <span className={a.changeRate.startsWith('+') ? 'text-green' : 'text-red'}>
                        {a.changeRate}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default HistoryPage;
