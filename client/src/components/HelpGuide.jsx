import { useState } from 'react';

const TERMS = [
  {
    abbr: 'PER',
    name: '주가수익비율',
    en: 'Price-Earnings Ratio',
    formula: '주가 ÷ EPS(주당순이익)',
    explain: '주가가 기업 연간 순이익의 몇 배인지 나타냅니다. 같은 업종 내에서 PER이 낮을수록 저평가 상태일 수 있습니다.',
    range: '10배 미만: 저평가 · 10~20배: 적정 · 20배 이상: 고평가 주의',
    warn: '적자 기업은 PER 계산 불가(N/A). 성장주는 높게 나올 수 있습니다.',
  },
  {
    abbr: 'PBR',
    name: '주가순자산비율',
    en: 'Price-Book Ratio',
    formula: '주가 ÷ BPS(주당순자산)',
    explain: '주가가 기업의 순자산(장부가) 대비 몇 배인지 나타냅니다. 1배 미만이면 주가가 청산가치보다 낮다는 의미로 자산 대비 저평가입니다.',
    range: '1배 미만: 저평가 · 1~2배: 적정 · 2배 이상: 성장 프리미엄 또는 고평가',
    warn: '금융·제조업처럼 자산이 많은 업종에서 특히 유용합니다.',
  },
  {
    abbr: 'EPS',
    name: '주당순이익',
    en: 'Earnings Per Share',
    formula: '당기순이익 ÷ 발행주식수',
    explain: '주식 1주당 창출한 순이익. 꾸준히 증가하는 기업일수록 실적이 성장하고 있다는 신호입니다.',
    range: '양수(+): 수익 창출 · 음수(-): 해당 기간 적자',
    warn: null,
  },
  {
    abbr: 'BPS',
    name: '주당순자산',
    en: 'Book Value Per Share',
    formula: '순자산(자기자본) ÷ 발행주식수',
    explain: '주식 1주당 보유하는 순자산 가치. 회사를 청산할 때 주당 받을 수 있는 금액의 이론적 기준이 됩니다.',
    range: '주가 < BPS: 자산 대비 저평가 · 주가 > BPS: 성장 기대 반영',
    warn: null,
  },
  {
    abbr: 'ROE',
    name: '자기자본이익률',
    en: 'Return on Equity',
    formula: '당기순이익 ÷ 자기자본 × 100',
    explain: '주주가 투자한 자본으로 얼마나 이익을 냈는지 측정하는 수익성 지표. 워런 버핏은 ROE 15% 이상인 기업을 선호합니다.',
    range: '15% 이상: 우수 · 8~15%: 평균 · 8% 미만: 수익성 낮음',
    warn: '부채를 크게 늘려도 ROE가 높아질 수 있으니 PBR과 함께 봅니다.',
  },
  {
    abbr: '배당수익률',
    name: '배당수익률',
    en: 'Dividend Yield',
    formula: '주당배당금 ÷ 현재 주가 × 100',
    explain: '주가 대비 받는 배당금 비율. 안정적인 배당 수입을 원하는 장기 투자자에게 중요한 지표입니다.',
    range: '3% 이상: 고배당 · 1~3%: 보통 · 0%: 무배당',
    warn: '배당이 높아도 기업 성장성이 낮으면 주가 하락 가능성에 주의.',
  },
  {
    abbr: '시가총액',
    name: '시가총액',
    en: 'Market Capitalization',
    formula: '현재 주가 × 총 발행주식수',
    explain: '기업의 전체 시장 가치. 규모에 따라 대형주(1조원 이상), 중형주(3000억~1조), 소형주(3000억 미만)로 구분합니다.',
    range: '대형주: 안정적 · 소형주: 성장 가능성 높지만 변동성 큼',
    warn: null,
  },
  {
    abbr: 'KOSPI',
    name: '코스피(유가증권시장)',
    en: 'Korea Composite Stock Price Index',
    formula: null,
    explain: 'KRX 유가증권시장에 상장된 전체 주식의 시가총액을 1980년 1월 4일(기준=100)과 비교한 대표 지수. 삼성전자·SK하이닉스 등 대형 기업이 포함됩니다.',
    range: null,
    warn: null,
  },
  {
    abbr: 'KOSDAQ',
    name: '코스닥(벤처·중소기업 시장)',
    en: 'Korea Securities Dealers Automated Quotations',
    formula: null,
    explain: '주로 중소·벤처기업이 상장된 시장. KOSPI보다 변동성이 크고, 성장 가능성이 높은 기업이 많습니다.',
    range: null,
    warn: null,
  },
  {
    abbr: '거래량',
    name: '거래량',
    en: 'Trading Volume',
    formula: null,
    explain: '특정 기간 동안 거래된 주식 수. 거래량이 급증하면서 주가가 상승하면 신뢰도 높은 매수 신호일 수 있습니다.',
    range: '대량 거래 + 상승: 강한 매수 신호 · 대량 거래 + 하락: 매도 압력 강함',
    warn: null,
  },
  {
    abbr: '상한가 / 하한가',
    name: '서킷브레이커 & 가격제한',
    en: 'Price Limit',
    formula: null,
    explain: '한국 주식시장은 하루 최대 ±30%까지만 등락할 수 있습니다. 상한가는 전일 대비 +30%, 하한가는 -30% 입니다.',
    range: null,
    warn: '상한가 포착 시 다음 날 갭 하락 가능성도 항상 존재합니다.',
  },
];

function HelpGuide({ onClose }) {
  const [open, setOpen] = useState(null);

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2>📚 주식 주요 지표 가이드</h2>
          <button className="chart-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="help-body">
          <p className="help-intro">
            주요 재무 지표를 이해하면 더 나은 투자 판단이 가능합니다.
            각 항목을 클릭하면 상세 설명을 볼 수 있습니다.
          </p>
          {TERMS.map((t) => (
            <div
              key={t.abbr}
              className={`help-item${open === t.abbr ? ' expanded' : ''}`}
              onClick={() => setOpen(open === t.abbr ? null : t.abbr)}
            >
              <div className="help-item-header">
                <span className="help-abbr">{t.abbr}</span>
                <span className="help-name">{t.name}</span>
                {t.en && <span className="help-en">{t.en}</span>}
                <span className="help-toggle">{open === t.abbr ? '▲' : '▼'}</span>
              </div>
              {open === t.abbr && (
                <div className="help-item-body">
                  {t.formula && (
                    <div className="help-formula">
                      <strong>계산식</strong>: {t.formula}
                    </div>
                  )}
                  <p className="help-explain">{t.explain}</p>
                  {t.range && (
                    <div className="help-range">
                      <span className="text-green">✓</span> {t.range}
                    </div>
                  )}
                  {t.warn && (
                    <div className="help-warn">
                      <span style={{ color: 'var(--yellow)' }}>⚠</span> {t.warn}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <p className="help-disclaimer">
            ⚠️ 본 가이드는 교육 목적으로 제공되며, 투자 권유가 아닙니다.
          </p>
        </div>
      </div>
    </div>
  );
}

export default HelpGuide;
