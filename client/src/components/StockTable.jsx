function StockTable({ title, stocks, color, onChartOpen }) {
  return (
    <section className={`section stock-section ${color}`}>
      <h2 className="section-title">{title}</h2>
      {stocks.length === 0 ? (
        <p className="empty">데이터 없음</p>
      ) : (
        <div className="table-wrapper">
          <table className="stock-table">
            <thead>
              <tr>
                <th>#</th>
                <th>종목명</th>
                <th>현재가</th>
                <th>등락률</th>
                <th>거래량</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s, i) => {
                const isUp = s.changeRate?.includes('+') ||
                  (!s.changeRate?.includes('-') && parseFloat(s.changeRate) > 0);
                const priceNum = parseInt(s.price, 10);
                const volNum = parseInt(s.volume, 10);
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
                    <td className="price">{isNaN(priceNum) ? s.price : priceNum.toLocaleString()}원</td>
                    <td className={`rate ${isUp ? 'text-red' : 'text-blue'}`}>{s.changeRate}</td>
                    <td className="volume">{isNaN(volNum) ? s.volume : volNum.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="data-source">
        <span className="data-source-tag naver">📡 네이버 금융</span>
      </div>
    </section>
  );
}

export default StockTable;
