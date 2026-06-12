import { useState, useEffect, useCallback } from "react";
import AppHeader from "../components/common/AppHeader";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";

const V = {
  bg0: "#000", bg1: "#0a0a0a", bg2: "#0d0d0d", line: "#1a1a1a", line2: "#242424",
  ink0: "#fff", ink1: "#d8dde8", ink2: "#aab4c8", ink3: "#7a7a7a", ink4: "#5a5a5a", ink5: "#3a3a3a",
  grn: "#2ee07a", grnBg: "#0d1f14", grnBd: "#1a3a24",
  red: "#ff5566", redBg: "#1a0a10", redBd: "#3a1820",
  org: "#ffaa33", orgBg: "#1a1206", orgBd: "#3a2a14",
  blu: "#4ea6ff", bluBg: "#08182a", bluBd: "#1a3358",
  pur: "#9b7bff",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR','Malgun Gothic',system-ui,sans-serif",
};

const MENU_ITEMS = [
  { id: "all",    name: "전체 뉴스",  color: V.ink2 },
  { id: "서울교통", name: "도로·정체",  color: V.blu },
  { id: "교통사고", name: "사고·통제",  color: V.red },
  { id: "대중교통", name: "대중교통",  color: V.grn },
  { id: "날씨교통", name: "날씨 영향",  color: V.org },
];

const menuNameOf = (id) => MENU_ITEMS.find(m => m.id === id)?.name || id || "기타";

function sentStyle(s) {
  if (s === "혼잡악화") return { color: V.red, borderColor: V.redBd, background: V.redBg };
  if (s === "교통개선") return { color: V.grn, borderColor: V.grnBd, background: V.grnBg };
  return { color: "#cfcfcf", borderColor: "#2a2a2a", background: "#1a1a1a" };
}

function sentDot(s) {
  if (s === "혼잡악화") return V.red;
  if (s === "교통개선") return V.grn;
  return "#9a9a9a";
}

// SVG 도넛 차트
function Donut({ pct, color, label, valueStr }) {
  const R = 32, C = 2 * Math.PI * R;
  const dash = Math.min((pct / 100) * C, C);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ width: 62, height: 62, position: "relative", flexShrink: 0 }}>
        <svg viewBox="0 0 96 96" style={{ width: "100%", height: "100%", display: "block" }}>
          <circle cx="48" cy="48" r={R} fill="none" stroke="#1a1a1a" strokeWidth="9" />
          <circle cx="48" cy="48" r={R} fill="none" stroke={color} strokeWidth="9"
            strokeLinecap="butt"
            strokeDasharray={`${dash} ${C}`}
            transform="rotate(-90 48 48)" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: V.mono }}>
          <b style={{ fontSize: 12, color: "#fff", fontWeight: 800, lineHeight: 1 }}>{valueStr}</b>
        </div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: V.ink2, letterSpacing: 0.1, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

// 뉴스 카드
function NewsCard({ item }) {
  const trust = +(100 - parseFloat(item.clickbaitProb || 0)).toFixed(1);
  const bait = +parseFloat(item.clickbaitProb || 0).toFixed(1);
  const sent = sentStyle(item.sentiment);

  return (
    <article style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Row 1: chips + date */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {/* 카테고리 */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, color: V.blu, borderColor: V.bluBd, background: V.bluBg, border: `1px solid ${V.bluBd}` }}>
            {menuNameOf(item.category)}
          </span>
          {/* 감성 */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, border: `1px solid ${sent.borderColor}`, color: sent.color, background: sent.background }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: sentDot(item.sentiment), display: "inline-block" }} />
            {item.sentiment}
          </span>
          {/* 유형 */}
          {item.articleType && (
            <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, fontWeight: 800, padding: "4px 10px", borderRadius: 999, color: V.pur, border: "1px solid #2a1f5c", background: "#0f0a1f" }}>
              기사유형 · {item.articleType} · {(+parseFloat(item.typeProb || 0)).toFixed(0)}%
            </span>
          )}
        </div>
        <span style={{ fontFamily: V.mono, fontSize: 12, color: V.ink4, whiteSpace: "nowrap" }}>{item.pubDate}</span>
      </div>

      {/* 제목 */}
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: 0.1, lineHeight: 1.4 }}>{item.title}</h3>

      {/* 요약 */}
      {item.summary && (
        <p style={{ margin: 0, fontSize: 12, color: V.ink2, lineHeight: 1.5 }}>{item.summary}</p>
      )}

      {/* 미터 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
        {[
          { label: "기사 신뢰도", val: trust, color: V.blu },
          { label: "제목 과장도", val: bait, color: V.red },
        ].map(m => (
          <div key={m.label} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: V.mono, fontSize: 12, color: V.ink3 }}>
              <span style={{ color: V.ink2, fontWeight: 500, fontSize: 12 }}>{m.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "#fff" }}>{m.val}%</span>
            </div>
            <div style={{ height: 6, background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${m.val}%`, background: m.color }} />
            </div>
          </div>
        ))}
      </div>

      {/* 원문 링크 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, paddingTop: 10, borderTop: `1px solid ${V.line}` }}>
        <a href={item.link} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "#000", border: `1px solid ${V.line}`, borderRadius: 999, color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
          원문 보기 →
        </a>
        <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 14, color: V.ink4 }}>
          교통 뉴스 · {item.pubDate?.split(" ")[0]}
        </span>
      </div>
    </article>
  );
}

export default function NewsDashboard({ onGoMain, onGoMap, onGoCctv, onGoSimulation, onGoComplaints, onGoMyPage, onLogout, selectedGu, notifQueue = [], onDismissNotif }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMenu, setSelectedMenu] = useState("all");
  const [sort, setSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [page, setPage] = useState(1);
  const [time, setTime] = useState(new Date());
  const PER_PAGE = 5;

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/news/latest?limit=200`)
      .then(r => r.json())
      .then(d => { setNews(d.news || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // 메뉴별 개수
  const countOf = (id) => id === "all" ? news.length : news.filter(n => n.category === id).length;

  // 필터링
  const pool = selectedMenu === "all" ? news : news.filter(n => n.category === selectedMenu);
  const filtered = pool
    .filter(n => !query || n.title?.includes(query) || n.summary?.includes(query) || n.category?.includes(query))
    .slice()
    .sort((a, b) => {
      if (sort === "recent") return (b.pubDate || "").localeCompare(a.pubDate || "");
      if (sort === "trust")  return parseFloat(a.clickbaitProb || 0) - parseFloat(b.clickbaitProb || 0);
      if (sort === "bait")   return parseFloat(b.clickbaitProb || 0) - parseFloat(a.clickbaitProb || 0);
      return 0;
    });

  // 통계
  const total = pool.length;
  const avgTrust = total ? pool.reduce((s, n) => s + (100 - parseFloat(n.clickbaitProb || 0)), 0) / total : 0;
  const avgBait  = total ? pool.reduce((s, n) => s + parseFloat(n.clickbaitProb || 0), 0) / total : 0;
  const goodN = pool.filter(n => n.sentiment === "교통개선").length;
  const badN  = pool.filter(n => n.sentiment === "혼잡악화").length;
  const neutN = total - goodN - badN;
  const goodPct = total ? (goodN / total) * 100 : 0;
  const badPct  = total ? (badN  / total) * 100 : 0;
  const neutPct = total ? (neutN / total) * 100 : 0;

  // 페이지네이션
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleSearch = useCallback(() => {
    setQuery(inputVal.trim());
    setPage(1);
  }, [inputVal]);

  const changeMenu = (id) => { setSelectedMenu(id); setPage(1); };
  const changeSort = (s) => { setSort(s); setPage(1); };

  return (
    <div style={{ fontFamily: V.sans, background: V.bg0, color: V.ink1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* 공통 헤더 */}
      <AppHeader
        activePage="news"
        selectedGu={selectedGu}
        statusText={news.length > 0 ? `LIVE · ${news.length}건 수집됨` : "데이터 없음"}
        statusLive={news.length > 0}
        onGoMain={onGoMain}
        onGoMap={onGoMap}
        onGoNews={() => {}}
        onGoCctv={onGoCctv}
        onGoSimulation={onGoSimulation}
        onGoComplaints={onGoComplaints}
        onGoMyPage={onGoMyPage}
        onLogout={onLogout}
        notifQueue={notifQueue}
        onDismissNotif={onDismissNotif}
      />
{/* ── 검색바 ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${V.line}`, background: "#050505", flexShrink: 0 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, background: "#000", border: `1px solid ${V.line}`, borderRadius: 2, padding: "0 14px", height: 38 }}>
          <span style={{ fontFamily: V.mono, fontSize: 14, color: V.ink4, letterSpacing: 0.6, textTransform: "uppercase", whiteSpace: "nowrap" }}>키워드 검색</span>
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="예) 강남 교차로, 폭우, 지하철 2호선"
            style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: "#fff", fontSize: 14, fontWeight: 500, fontFamily: V.sans }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: V.mono, fontSize: 14, color: V.ink4, letterSpacing: 0.6, textTransform: "uppercase" }}>정렬</span>
          <div style={{ display: "flex", background: "#000", border: `1px solid ${V.line}`, borderRadius: 2, padding: 3, gap: 2 }}>
            {[["recent","최신순"],["trust","신뢰도 높은 순"],["bait","제목 과장도 높은 순"]].map(([id, label]) => (
              <button key={id} onClick={() => changeSort(id)}
                style={{ appearance: "none", border: 0, background: sort === id ? "#141414" : "transparent", color: sort === id ? "#fff" : V.ink3, fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 2, cursor: "pointer", boxShadow: sort === id ? "inset 0 0 0 1px #2a2a2a" : "none", fontFamily: V.sans }}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={handleSearch}
            style={{ height: 38, padding: "0 18px", border: `1px solid ${V.line}`, background: "#141414", color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: 0.5, borderRadius: 2, cursor: "pointer", fontFamily: V.sans }}>
            검색
          </button>
        </div>
      </div>

      {/* ── 메인 레이아웃 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 8, padding: 8, flex: 1, alignItems: "flex-start" }}>

        {/* 사이드바 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 70 }}>

          {/* 종합 분석 카드 */}
          <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2 }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, background: "#080808", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", display: "inline-flex", alignItems: "center" }}>
                <span style={{ color: V.ink5, marginRight: 8, fontSize: 11 }}>▪</span>
                교통 뉴스 분석 · {menuNameOf(selectedMenu)}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 12, color: V.ink2, padding: "4px 9px", border: `1px solid ${V.line}`, borderRadius: 2, background: "#000" }}>
                총 {total}건
              </span>
            </div>
            <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 10 }}>
              {/* 도넛 3개 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                <Donut pct={avgTrust} color={V.blu}  label="기사 신뢰도"    valueStr={`${avgTrust.toFixed(1)}%`} />
                <Donut pct={avgBait}  color={V.red}  label="제목 과장도"    valueStr={`${avgBait.toFixed(1)}%`} />
                <Donut pct={goodPct}  color={V.grn}  label="교통 개선"    valueStr={`${goodPct.toFixed(0)}%`} />
              </div>

              {/* 감성 분포 바 */}
              <div style={{ background: "#000", border: `1px solid ${V.line}`, borderRadius: 2, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: V.ink3, fontFamily: V.mono }}>
                  <b style={{ color: "#fff", fontWeight: 600, fontSize: 12, fontFamily: V.sans }}>교통 영향 분포</b>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: V.ink4 }}>총 {total}건</span>
                </div>
                <div style={{ display: "flex", height: 8, background: "#0d0d0d", border: `1px solid ${V.line}`, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${badPct}%`,  background: V.red }} />
                  <div style={{ width: `${neutPct}%`, background: "#6f6f6f" }} />
                  <div style={{ width: `${goodPct}%`, background: V.grn }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[["혼잡악화", V.red, badN, badPct], ["교통개선", V.grn, goodN, goodPct], ["중립", "#9a9a9a", neutN, neutPct]].map(([label, c, n, pct]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />
                      <span style={{ color: V.ink2, fontWeight: 500 }}>{label}</span>
                      <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 12, fontWeight: 700, color: "#fff" }}>
                        {n}<em style={{ fontStyle: "normal", fontSize: 10.5, color: V.ink4, marginLeft: 2 }}>건 · {pct.toFixed(0)}%</em>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 범례 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
                {[[V.blu, "기사 신뢰도", "사실 기반으로 작성된 정도"], [V.red, "제목 과장도", "과장·자극적 제목 가능성"], [V.grn, "교통 개선", "교통 개선 관련 기사 비율"]].map(([c, b, i]) => (
                  <div key={b} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 8, alignItems: "baseline", fontSize: 12.5, color: V.ink2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, alignSelf: "center", flexShrink: 0 }} />
                    <b style={{ color: "#fff", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>{b}</b>
                    <i style={{ fontStyle: "normal", color: V.ink3, fontSize: 12 }}>{i}</i>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 메뉴 선택 */}
          <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2 }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${V.line}`, background: "#080808" }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", display: "inline-flex", alignItems: "center" }}>
                <span style={{ color: V.ink5, marginRight: 8, fontSize: 11 }}>▪</span>메뉴 선택
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {MENU_ITEMS.map(s => {
                const isOn = selectedMenu === s.id;
                const cnt = countOf(s.id);
                return (
                  <button key={s.id} onClick={() => changeMenu(s.id)}
                    style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "12px 14px", background: isOn ? "#141414" : "transparent", border: 0, borderBottom: `1px solid ${V.line}`, color: isOn ? "#fff" : V.ink2, fontSize: 16, fontWeight: 600, textAlign: "left", cursor: "pointer", boxShadow: isOn ? `inset 2px 0 0 ${s.color}` : "none", fontFamily: V.sans }}>
                    <span style={{ width: 8, height: 8, borderRadius: 1, background: s.color }} />
                    <span>{s.name}</span>
                    <span style={{ fontFamily: V.mono, fontSize: 14, color: isOn ? "#fff" : V.ink4, fontWeight: 600 }}>{cnt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 뉴스 리스트 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 4px" }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>
              {query ? `"${query}" ` : ""}{menuNameOf(selectedMenu)} 검색 결과
            </span>
            <span style={{ fontFamily: V.mono, fontSize: 14, color: V.ink4 }}>
              {filtered.length}건 · {page}/{totalPages} 페이지
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: V.ink3, fontFamily: V.mono }}>뉴스 로딩 중...</div>
            ) : slice.length === 0 ? (
              <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 8, padding: "32px 18px", textAlign: "center", color: V.ink3, fontFamily: V.mono }}>
                {news.length === 0 ? "수집된 뉴스가 없습니다. 뉴스 수집 서버에서 /news/fetch를 실행해 데이터를 수집하세요." : "검색 결과가 없습니다."}
              </div>
            ) : (
              slice.map((item, i) => <NewsCard key={item.link || i} item={item} />)
            )}
          </div>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "18px 0 24px" }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ minWidth: 34, height: 34, display: "grid", placeItems: "center", background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink3, fontFamily: V.mono, fontSize: 12, cursor: "pointer", opacity: page === 1 ? 0.4 : 1 }}>‹</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const from = Math.max(1, Math.min(page - 3, totalPages - 6));
                const p = from + i;
                if (p > totalPages) return null;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    style={{ minWidth: 34, height: 34, display: "grid", placeItems: "center", background: p === page ? "#141414" : V.bg1, border: `1px solid ${p === page ? "#2a2a2a" : V.line}`, borderRadius: 2, color: p === page ? "#fff" : V.ink3, fontFamily: V.mono, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ minWidth: 34, height: 34, display: "grid", placeItems: "center", background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, color: V.ink3, fontFamily: V.mono, fontSize: 12, cursor: "pointer", opacity: page === totalPages ? 0.4 : 1 }}>›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
