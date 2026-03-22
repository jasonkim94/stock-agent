import { useState } from 'react';
import axios from 'axios';

function LoginPage({ onLogin }) {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSendCode = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/send-code', { email });
      setMessage(data.message);
      setStep('code');
    } catch (e) {
      setError(e.response?.data?.error || '발송 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/verify-code', { email, code });
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_email', data.email);
      onLogin(data.email);
    } catch (e) {
      setError(e.response?.data?.error || '인증 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-logo">
          InsightLedger<span className="logo-ai">AI</span>
        </div>
        <p className="login-subtitle">AI 주식 분석 서비스</p>

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="login-form">
            <label className="login-label">이메일 주소</label>
            <input
              type="email"
              className="login-input"
              placeholder="name@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? '발송 중...' : '📧 인증코드 받기'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerify} className="login-form">
            <p className="login-sent-msg">📬 <strong>{email}</strong>로<br/>인증코드를 보냈습니다.</p>
            <label className="login-label">6자리 인증코드</label>
            <input
              type="text"
              className="login-input code-input"
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              required
              autoFocus
            />
            {error && <p className="login-error">{error}</p>}
            {message && !error && <p className="login-message">{message}</p>}
            <button type="submit" className="login-btn" disabled={loading || code.length < 6}>
              {loading ? '확인 중...' : '🔐 로그인'}
            </button>
            <button
              type="button"
              className="login-btn-secondary"
              onClick={() => { setStep('email'); setCode(''); setError(''); setMessage(''); }}
            >
              ← 이메일 다시 입력
            </button>
          </form>
        )}

        <p className="login-footer">허가된 이메일만 접속할 수 있습니다.<br/>이메일로 6자리 인증코드를 보내드립니다.</p>
      </div>
    </div>
  );
}

export default LoginPage;
