import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{background:'#fef2f2',color:'#ef4444',padding:'24px',fontFamily:'monospace',whiteSpace:'pre-wrap',fontSize:'13px',borderRadius:'12px',margin:'20px',border:'1px solid #fecaca'}}>
          <b>런타임 에러</b>{'\n\n'}{this.state.err?.stack || String(this.state.err)}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
