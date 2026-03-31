function AIRecommend({ recommendation: r, onChartOpen, onAnalyzeOpen }) {
  if (!r) return null;

  const sentimentColor =
    r.sentiment === 'BULLISH' ? 'green' :
    r.sentiment === 'BEARISH' ? 'red' : 'yellow';

  const riskColor = { '낮음': 'green', '중간': 'yellow', '높음': 'red' };
  const strategyIcon = { '단기': '⚡', '중기': '📅', '장기': '🏦' };
  const categoryIcon = { '우량주': '🏢', '성장주': '🚀', '가치주': '💎' };

  return (
    <section className="section ai-section">
      <h2 className="section-title">🤖 AI 추천 결과</h2>

      {/* 시장 요약 */}
      <div className="market-summary">
        <span className={`sentiment-badge ${sentimentColor}`}>
          {r.sentimentKo || r.sentiment}
        </span>
        <p>{r.marketSummary}</p>
      </div>

      {/* 추천 종목 */}
      <h3 className="sub-title">📌 매수 추천 TOP {r.recommendations?.length ?? 0}</h3>
      <div className="rec-grid">
        {r.recommendations?.map((rec, i) => {
          const priceNum = parseInt(String(rec.currentPrice).replace(/,/g, ''), 10);
          return (
            <div className="rec-card" key={i}>
              <div className="rec-header">
                <span className="rec-rank">#{rec.rank}</span>
                <span className="rec-name">{rec.name}</span>
                <span className="rec-market">{rec.market}</span>
                {rec.code && (
                  <button className="btn-chart-mini" onClick={() => onChartOpen?.(rec.code, rec.name)} title="차트 보기">
                    📊
                  </button>
                )}
              </div>
              <div className="rec-price">
                {!isNaN(priceNum) && <span>{priceNum.toLocaleString()}원</span>}
                <span className={rec.changeRate?.toString().startsWith('-') ? 'text-blue' : 'text-red'}>{rec.changeRate}</span>
              </div>
              <p className="rec-reason">{rec.reason}</p>
              <div className="rec-tags">
                {rec.category && (
                  <span className="tag tag-category">
                    {categoryIcon[rec.category] || '📊'} {rec.category}
                  </span>
                )}
                <span className={`tag risk-${riskColor[rec.riskLevel] || 'yellow'}`}>
                  리스크: {rec.riskLevel}
                </span>
                <span className="tag">
                  {strategyIcon[rec.strategy] || '📈'} {rec.strategy}
                </span>
                <span className="tag text-green">목표: {rec.targetReturn}</span>
              </div>
              {/* 카드 하단 액션 */}
              <div className="rec-card-actions">
                <button
                  className="btn-analyze-stock"
                  onClick={() => onAnalyzeOpen?.(rec)}
                >
                  🔍 종목분석
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 섹터 인사이트 */}
      {r.sectorInsight && (
        <div className="sector-insight">
          <h3>🏭 섹터 인사이트</h3>
          <p>{r.sectorInsight}</p>
        </div>
      )}

      {/* 주의사항 */}
      {r.cautions?.length > 0 && (
        <div className="cautions">
          <h3>⚠️ 투자 주의사항</h3>
          <ul>
            {r.cautions.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      <div className="data-source">
        <span className="data-source-tag naver">📡 네이버 금융</span>
        <span className="data-source-tag ai">🤖 Groq AI (llama-3.1-8b)</span>
      </div>
      <p className="disclaimer">{r.disclaimer}</p>
    </section>
  );
}

export default AIRecommend;
