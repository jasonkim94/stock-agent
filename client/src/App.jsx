import { useState, useEffect } from 'react';
import axios from 'axios';
import MarketIndex from './components/MarketIndex';
import StockTable from './components/StockTable';
import AIRecommend from './components/AIRecommend';
import SectorAnalysis from './components/SectorAnalysis';
import StockSearch from './components/StockSearch';
import StockChart from './components/StockChart';
import HistoryPage from './components/HistoryPage';
import StockDetail from './components/StockDetail';
import StockAnalysis from './components/StockAnalysis';
import PriceTracker from './components/PriceTracker';
import HelpGuide from './components/HelpGuide';
import LoginPage from './components/LoginPage';

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tab, setTab] = useState('main');       // 'main' | 'history' | 'tracker'
  const [chart, setChart] = useState(null);       // { code, name }
  const [detail, setDetail] = useState(null);     // { code, name }
  const [analysis, setAnalysis] = useState(null); // rec 객체 전체
  const [showHelp, setShowHelp] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [authEmail, setAuthEmail] = useState(localStorage.getItem('auth_email'));
  const [authChecking, setAuthChecking] = useState(!!localStorage.getItem('auth_token'));

  // 앱 시작 시 저장된 토큰으로 자동 로그인 검증
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) { setAuthChecking(false); return; }
    axios.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        localStorage.setItem('auth_email', data.email);
        setAuthEmail(data.email);
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_email');
        setAuthEmail(null);
      })
      .finally(() => setAuthChecking(false));
  }, []);

  // axios 인터셉터: 토큰 자동 첨부 + 401 자동 로그아웃
  useEffect(() => {
    const reqId = axios.interceptors.request.use(config => {
      const token = localStorage.getItem('auth_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    const resId = axios.interceptors.response.use(
      res => res,
      err => {
        if (err.response?.status === 401 && !err.config?.url?.includes('/api/auth/')) {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_email');
          setAuthEmail(null);
        }
        return Promise.reject(err);
      }
    );
    return () => {
      axios.interceptors.request.eject(reqId);
      axios.interceptors.response.eject(resId);
    };
  }, []);

  const handleLogin = (email) => setAuthEmail(email);
  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_email');
    setAuthEmail(null);
  };

  if (authChecking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', color: 'var(--subtext)' }}>
          <div className="loader" />
          <p style={{ marginTop: 12 }}>로그인 확인 중...</p>
        </div>
      </div>
    );
  }

  if (!authEmail) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const openChart   = (code, name) => setChart({ code, name });
  const closeChart  = () => setChart(null);
  const openDetail  = (code, name) => setDetail({ code, name });
  const closeDetail = () => setDetail(null);
  const openAnalysis  = (rec) => setAnalysis(rec);
  const closeAnalysis = () => setAnalysis(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result } = await axios.get('/api/recommend');
      setData(result);
      setLastUpdated(new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveAnalysis = () => {
    if (!data?.recommendation) return;
    const history = JSON.parse(localStorage.getItem('stock_ai_history') || '[]');
    const entry = {
      id: new Date().toISOString(),
      savedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      dataDate: data.dataDate,
      sentiment: data.recommendation.sentiment,
      sentimentKo: data.recommendation.sentimentKo,
      marketSummary: data.recommendation.marketSummary,
      recommendations: (data.recommendation.recommendations || []).map(r => ({
        rank: r.rank,
        name: r.name,
        code: r.code,
        currentPrice: r.currentPrice,
        changeRate: r.changeRate,
        targetReturn: r.targetReturn,
        riskLevel: r.riskLevel,
        strategy: r.strategy,
        reason: r.reason,
      })),
    };
    history.unshift(entry);
    localStorage.setItem('stock_ai_history', JSON.stringify(history.slice(0, 50)));
    setSaveMsg('✅ 저장됨!');
    setTimeout(() => setSaveMsg(''), 2500);
  };

  return (
    <div className="app">
      {/* ── Top Navigation Bar ── */}
      <nav className="topnav">
        <div className="topnav-left">
          <span className="topnav-logo">InsightLedger<span className="logo-ai">AI</span></span>
          <button
            className={`topnav-link ${tab === 'main' ? 'active' : ''}`}
            onClick={() => setTab('main')}
          >
            대시보드
          </button>
          <button
            className={`topnav-link ${tab === 'history' ? 'active' : ''}`}
            onClick={() => setTab('history')}
          >
            분석 이력
          </button>
          <button
            className={`topnav-link ${tab === 'tracker' ? 'active' : ''}`}
            onClick={() => setTab('tracker')}
          >
            시세 추종
          </button>
          <button className="topnav-link" onClick={() => setShowHelp(true)}>
            투자 가이드
          </button>
        </div>
        <div className="topnav-right">
          <span className="topnav-email">{authEmail}</span>
          <button className="topnav-link" onClick={handleLogout}>로그아웃</button>
          {lastUpdated && <span className="topnav-updated">업데이트: {lastUpdated}</span>}
          <button className="topnav-help" onClick={() => setShowHelp(true)} title="도움말">?</button>
        </div>
      </nav>

      <main className="main-content">
        {tab === 'history' && (
          <HistoryPage onDetailOpen={openDetail} onChartOpen={openChart} />
        )}

        {tab === 'tracker' && (
          <PriceTracker onChartOpen={openChart} onAnalyzeOpen={openAnalysis} />
        )}

        {tab === 'main' && (
          <>
            {/* ── Portfolio Summary Bar ── */}
            <section className="portfolio-bar">
              <div className="portfolio-bar-left">
                <span className="portfolio-label">AI 주식 분석</span>
                <span className="portfolio-sublabel">KOSPI · KOSDAQ 실시간 AI 분석</span>
              </div>
              <div className="portfolio-bar-right">
                {data && (
                  <button onClick={saveAnalysis} className="btn-save">
                    {saveMsg || '💾 저장'}
                  </button>
                )}
                <button onClick={analyze} disabled={loading} className="btn-analyze">
                  {loading ? <><span className="spin">⟳</span> 분석 중…</> : '🤖 AI 분석 시작'}
                </button>
              </div>
            </section>

            {error && <div className="error-box">❌ 오류: {error}</div>}

            {loading && (
              <div className="loading-box">
                <div className="loader" />
                <p>📡 네이버 금융 데이터 수집 중...</p>
                <p>🧠 Groq AI가 종목을 분석하고 있습니다. (약 5~10초 소요)</p>
              </div>
            )}

            {data && !loading && (
              <div className="dashboard-grid">
                {/* Left column */}
                <div className="dash-left">
                  <MarketIndex market={data.market} dataDate={data.dataDate} />
                  <div className="stock-grid">
                    <StockTable title="KOSPI 상승 종목" stocks={data.stocks?.kospi || []} color="blue" onChartOpen={openChart} />
                    <StockTable title="KOSDAQ 상승 종목" stocks={data.stocks?.kosdaq || []} color="purple" onChartOpen={openChart} />
                  </div>
                </div>
                {/* Right column */}
                <div className="dash-right">
                  <AIRecommend recommendation={data.recommendation} onChartOpen={openChart} onAnalyzeOpen={openAnalysis} />
                </div>
              </div>
            )}

            {!data && !loading && (
              <div className="welcome-box">
                <div className="welcome-icon">📊</div>
                <h2>AI 주식 추천을 시작해보세요</h2>
                <div className="welcome-features">
                  <div className="welcome-feature">
                    <span className="wf-icon">🔎</span>
                    <div><strong>실시간 시세</strong><p>네이버 금융 KOSPI·KOSDAQ 시세 수집</p></div>
                  </div>
                  <div className="welcome-feature">
                    <span className="wf-icon">🧠</span>
                    <div><strong>AI 분석</strong><p>Groq AI가 시장 분석 및 종목 추천</p></div>
                  </div>
                  <div className="welcome-feature">
                    <span className="wf-icon">📋</span>
                    <div><strong>TOP 5 추천</strong><p>매수 추천 종목 + 상세 재무 지표</p></div>
                  </div>
                  <div className="welcome-feature">
                    <span className="wf-icon">💾</span>
                    <div><strong>이력 관리</strong><p>분석 결과 저장 및 트렌드 추적</p></div>
                  </div>
                </div>
                <p className="disclaimer">⚠️ 본 서비스는 참고용이며, 투자 손실에 대한 책임을 지지 않습니다.</p>
              </div>
            )}

            {/* Bottom sections - full width */}
            <div className="bottom-sections">
              <SectorAnalysis onChartOpen={openChart} onAnalyzeOpen={openAnalysis} />
              <StockSearch onChartOpen={openChart} onAnalyzeOpen={openAnalysis} />
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        Developed by Jason via Vibe Coding
      </footer>

      {chart    && <StockChart  code={chart.code}  name={chart.name}  onClose={closeChart} />}
      {detail   && <StockDetail code={detail.code} name={detail.name} onClose={closeDetail} onChartOpen={openChart} />}
      {analysis && <StockAnalysis rec={analysis} onClose={closeAnalysis} onChartOpen={openChart} onSave={() => setSaveMsg('⭐ 저장됨!')} />}
      {showHelp && <HelpGuide onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
