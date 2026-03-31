function MarketIndex({ market, dataDate }) {
  const renderCard = (name, idx) => {
    const price = idx?.closePrice || '-';
    const ratio = parseFloat(idx?.fluctuationsRatio ?? 0);
    const isUp = ratio > 0;
    const isDown = ratio < 0;
    const sign = isUp ? '+' : '';

    return (
      <div className={`index-card ${isUp ? 'up' : isDown ? 'down' : ''}`} key={name}>
        <div className="index-name">{name}</div>
        <div className="index-price">{price}</div>
        <div className={`index-change ${isUp ? 'text-red' : isDown ? 'text-blue' : ''}`}>
          {sign}{ratio.toFixed(2)}%
        </div>
      </div>
    );
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2 className="section-title">📊 시장 지수</h2>
        {dataDate && <span className="data-date">📅 네이버 금융 기준: {dataDate}</span>}
      </div>
      <div className="index-grid">
        {renderCard('KOSPI', market.kospi)}
        {renderCard('KOSDAQ', market.kosdaq)}
      </div>
      <div className="data-source">
        <span className="data-source-tag naver">📡 네이버 금융</span>
      </div>
    </section>
  );
}

export default MarketIndex;
