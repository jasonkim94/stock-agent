# InsightLedger AI — 아키텍처 뷰

> 본 문서는 `stock-agent` 프로젝트의 실행 구조를 다이어그램으로 정리한 아키텍처 뷰입니다.

---

## 1. 전체 시스템 아키텍처

```mermaid
graph TB
    subgraph Client["🖥️ 클라이언트 (React + Vite · Port 3000)"]
        Browser["브라우저"]
    end

    subgraph Server["⚙️ 서버 (Express.js · Port 5001)"]
        API["REST API\n/api/*"]
        Cache["인메모리 캐시\n(TTL: 3분)"]
        GroqQueue["Groq 직렬 큐\n(Rate Limit 방지)"]
    end

    subgraph External["🌐 외부 서비스"]
        NaverFinance["네이버 금융\nfinance.naver.com\n(HTML 스크래핑)"]
        NaverMobile["네이버 증권 모바일 API\nm.stock.naver.com"]
        NaverAC["네이버 자동완성 API\nac.stock.naver.com"]
        GroqAI["Groq AI API\napi.groq.com\n(llama-3.1-8b-instant)"]
    end

    subgraph Storage["💾 로컬 스토리지"]
        HistoryStore["stock_ai_history\n(분석 이력 최대 50건)"]
        WatchlistStore["stock_watchlist\n(관심 종목 목록)"]
    end

    Browser -->|"HTTP /api/*\n(axios)"| API
    API -->|"캐시 조회/저장"| Cache
    API -->|"AI 분석 요청"| GroqQueue
    GroqQueue -->|"POST /openai/v1/chat/completions"| GroqAI
    API -->|"주가 스크래핑"| NaverFinance
    API -->|"주가 API 호출"| NaverMobile
    API -->|"종목명 검색"| NaverAC
    Browser <-->|"읽기/쓰기"| Storage
```

---

## 2. 클라이언트 컴포넌트 계층 구조

```mermaid
graph TD
    App["App.jsx\n(루트 컴포넌트)"]

    subgraph Nav["네비게이션"]
        TopNav["TopNav Bar\n대시보드 / 분석이력 / 시세추종 / 투자가이드"]
    end

    subgraph Main["탭별 메인 콘텐츠"]
        Dashboard["대시보드 탭 (main)"]
        HistoryPage["분석 이력 탭\nHistoryPage.jsx"]
        PriceTracker["시세 추종 탭\nPriceTracker.jsx"]
    end

    subgraph DashComponents["대시보드 컴포넌트"]
        MarketIndex["MarketIndex.jsx\nKOSPI·KOSDAQ 지수"]
        StockTable["StockTable.jsx\n상승 종목 테이블"]
        AIRecommend["AIRecommend.jsx\nAI 추천 결과 TOP5"]
        SectorAnalysis["SectorAnalysis.jsx\n섹터(업종) 분석"]
        StockSearch["StockSearch.jsx\n종목 검색"]
    end

    subgraph Modals["전역 모달"]
        StockChart["StockChart.jsx\n주가 차트 (일/주/월/년)\nrecharts 사용"]
        StockDetail["StockDetail.jsx\n재무지표 상세"]
        StockAnalysis["StockAnalysis.jsx\nAI 심층 분석"]
        HelpGuide["HelpGuide.jsx\n투자 가이드"]
    end

    App --> TopNav
    App --> Dashboard
    App --> HistoryPage
    App --> PriceTracker
    Dashboard --> MarketIndex
    Dashboard --> StockTable
    Dashboard --> AIRecommend
    Dashboard --> SectorAnalysis
    Dashboard --> StockSearch
    App -->|"chart 상태"| StockChart
    App -->|"detail 상태"| StockDetail
    App -->|"analysis 상태"| StockAnalysis
    App -->|"showHelp 상태"| HelpGuide
```

---

## 3. 서버 API 라우트 및 데이터 흐름

```mermaid
flowchart LR
    Client(["클라이언트"])

    subgraph Routes["Express 라우트"]
        R1["GET /api/market"]
        R2["GET /api/stocks"]
        R3["GET /api/recommend\n(캐시 TTL 3분)"]
        R4["GET /api/sectors\n(캐시 TTL 30분)"]
        R5["GET /api/sector?no=&name="]
        R6["GET /api/search?q="]
        R7["GET /api/chart?code=&period="]
        R8["GET /api/stockinfo?code="]
        R9["GET /api/financial-statements?code="]
        R10["POST /api/analyze-financials"]
        R11["GET /api/analyze-stock?code="]
        R12["POST /api/track-stocks"]
    end

    subgraph Scrapers["데이터 수집 함수"]
        F1["getMarketIndex(code)\nm.stock.naver.com API"]
        F2["getRisingStocks(sosok)\nNaver 상승 종목 스크래핑"]
        F3["getSectors()\nNaver 업종 스크래핑"]
        F4["getSectorStocks(no)\nNaver 업종별 종목 스크래핑"]
        F5["fetchSisePage(code,page)\nNaver 일별시세 스크래핑"]
        F6["scrapeMetrics(code)\nNaver 재무지표 스크래핑"]
        F7["fetchStockNews(code)\nNaver 뉴스 스크래핑"]
    end

    subgraph AIFunctions["AI 분석 함수"]
        A1["analyzeWithAI(market,stocks)\n시장 분석 + TOP5 추천"]
        A2["analyzeSectorWithAI(name,stocks)\n섹터 분석 + TOP3 추천"]
        A3["callGroq(body)\n직렬 큐 + 재시도(3회)"]
    end

    Client --> R1 & R2 & R3 & R4 & R5 & R6 & R7 & R8 & R9 & R10 & R11 & R12

    R1 --> F1
    R2 --> F2
    R3 --> F1 & F2 & A1
    R4 --> F3
    R5 --> F4 & A2
    R6 -->|"ac.stock.naver.com"| NaverAC["Naver 자동완성 API"]
    R7 --> F5
    R8 --> F1 & F6
    R9 -->|"m.stock.naver.com\n/finance/annual,quarter"| NaverMobileAPI["Naver 모바일 재무 API"]
    R10 --> A3
    R11 --> F6 & F7 & A3
    R12 --> F1 & A3

    A1 --> A3
    A2 --> A3
    A3 -->|"llama-3.1-8b-instant"| GroqAI["Groq AI API"]
```

---

## 4. 주요 기능별 시퀀스 다이어그램

### 4-1. AI 추천 분석 (`🤖 AI 분석 시작` 버튼)

```mermaid
sequenceDiagram
    participant U as 사용자
    participant C as 클라이언트
    participant S as 서버
    participant N as 네이버 금융
    participant G as Groq AI

    U->>C: "AI 분석 시작" 클릭
    C->>S: GET /api/recommend
    S->>S: 캐시 확인 (TTL 3분)
    alt 캐시 히트
        S-->>C: 캐시 데이터 반환 (cached: true)
    else 캐시 미스
        par 병렬 수집
            S->>N: KOSPI 지수 조회
            S->>N: KOSDAQ 지수 조회
            S->>N: KOSPI 상승 종목 스크래핑
            S->>N: KOSDAQ 상승 종목 스크래핑
        end
        N-->>S: 시장 데이터
        S->>G: AI 분석 요청 (JSON 형식 지시)
        G-->>S: 추천 결과 JSON
        S->>S: 캐시 저장
        S-->>C: 분석 결과 반환
    end
    C-->>U: 대시보드 렌더링
```

### 4-2. 섹터 분석

```mermaid
sequenceDiagram
    participant U as 사용자
    participant C as SectorAnalysis
    participant S as 서버
    participant N as 네이버 금융
    participant G as Groq AI

    C->>S: GET /api/sectors (컴포넌트 마운트 시)
    S->>N: 업종 목록 스크래핑 (캐시 TTL 30분)
    N-->>S: 업종 목록
    S-->>C: 업종 리스트

    U->>C: 업종 선택 후 "분석" 클릭
    C->>S: GET /api/sector?no=&name=
    S->>N: 업종별 종목 스크래핑
    N-->>S: 종목 리스트 (최대 15개)
    S->>G: 섹터 AI 분석 요청
    G-->>S: 분석 결과 JSON (outlook, TOP3 추천)
    S-->>C: 분석 결과 반환
    C-->>U: 섹터 분석 결과 표시
```

### 4-3. 시세 추종 (관심 종목 추적)

```mermaid
sequenceDiagram
    participant U as 사용자
    participant C as PriceTracker
    participant LS as 로컬 스토리지
    participant S as 서버
    participant N as 네이버 모바일 API
    participant G as Groq AI

    U->>C: "시세 체크" 클릭 (또는 10분 자동 갱신)
    C->>LS: stock_watchlist 조회
    LS-->>C: 관심 종목 목록 [{code, name, price, strategy}]
    C->>S: POST /api/track-stocks (최대 20종목)
    par 종목별 병렬 수집
        S->>N: /api/stock/{code}/basic (현재가)
        S->>N: /api/stock/{code}/integration (PER, 52주 등)
    end
    N-->>S: 현재 시세 데이터
    S->>G: 매수/매도/유지 AI 판단 요청
    G-->>S: 판단 결과 JSON (action, urgency, confidence)
    S-->>C: 종목별 판단 결과
    C-->>U: 카드 형태로 결과 표시
```

---

## 5. 데이터 저장 구조 (로컬 스토리지)

```mermaid
erDiagram
    STOCK_AI_HISTORY {
        string id "ISO 날짜 (PK)"
        string savedAt "저장 시각 (KST)"
        string dataDate "데이터 기준 일시"
        string sentiment "BULLISH / BEARISH / NEUTRAL"
        string sentimentKo "강세 / 약세 / 중립"
        string marketSummary "시장 요약"
        array recommendations "추천 종목 배열 (최대 5)"
    }

    RECOMMENDATION {
        number rank "순위"
        string name "종목명"
        string code "종목코드"
        string currentPrice "현재가"
        string changeRate "등락률"
        string targetReturn "목표 수익률"
        string riskLevel "리스크 수준"
        string strategy "단기/중기/장기"
        string reason "추천 이유"
    }

    STOCK_WATCHLIST {
        string code "종목코드 (PK)"
        string name "종목명"
        string price "저장 당시 가격"
        string strategy "투자 전략"
        string reason "저장 이유"
    }

    STOCK_AI_HISTORY ||--o{ RECOMMENDATION : "recommendations[]"
```

---

## 6. 기술 스택 요약

| 구분 | 기술 | 역할 |
|---|---|---|
| **프론트엔드** | React 18 + Vite 5 | UI 렌더링 |
| **차트** | Recharts 3 | 주가 차트 (가격·거래량) |
| **HTTP 클라이언트** | Axios | API 요청 (클라이언트·서버 공통) |
| **백엔드** | Node.js + Express 4 | REST API 서버 |
| **HTML 파싱** | Cheerio | 네이버 금융 스크래핑 |
| **인코딩** | iconv-lite | EUC-KR → UTF-8 변환 |
| **AI 모델** | Groq (llama-3.1-8b-instant) | 시장 분석·종목 추천 |
| **상태 관리** | React useState / useEffect | 컴포넌트 로컬 상태 |
| **영구 저장** | Browser LocalStorage | 분석 이력·관심 종목 |
| **프록시** | Vite dev proxy | `/api` → `localhost:5001` |
