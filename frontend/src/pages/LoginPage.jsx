import { useState, useEffect } from "react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

const V = {
  bg:   "#000",
  card: "rgba(14,11,7,.35)",
  bd:   "#1a1a1a",
  bd2:  "#2a2a2a",
  ink:  "#e7ecf5",
  ink2: "#aab4c8",
  ink3: "#7a7a7a",
  ink4: "#3a3a3a",
  pri:  "#4ea6ff",
  ok:   "#2ee07a",
  err:  "#ff5566",
  warn: "#ffaa33",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR',system-ui,sans-serif",
};

// ── 공통 스타일 ────────────────────────────────────────────────────────────────
const s = {
  inp: {
    width: "100%", height: 48, padding: "0 16px",
    background: "rgba(255,255,255,.05)", border: `1px solid rgba(255,255,255,.14)`,
    borderRadius: 2, color: V.ink, fontSize: 15, fontWeight: 500,
    fontFamily: V.sans, outline: "none", boxSizing: "border-box",
  },
  lab: {
    fontFamily: V.mono, fontSize: 12, color: V.ink3,
    letterSpacing: ".5px", textTransform: "uppercase",
  },
  btn: (warn) => ({
    width: "100%", height: 54, border: "none", borderRadius: 2,
    background: warn ? V.warn : V.pri, color: "#000",
    fontSize: 15.5, fontWeight: 700, letterSpacing: ".5px",
    cursor: "pointer", marginTop: 10, fontFamily: V.sans,
  }),
  link: { color: V.ink2, fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "0 14px" },
  note: { marginTop: 14, fontSize: 11.5, color: V.ink3, textAlign: "center", lineHeight: 1.55 },
  hint: (type) => ({ fontSize: 10.5, fontFamily: V.mono, letterSpacing: ".2px", color: type === "ok" ? V.ok : V.err }),
};

function Field({ label, children, hint, hintType }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={s.lab}><b style={{ color: V.ink, fontWeight: 500, fontFamily: V.sans, fontSize: 14, textTransform: "none", letterSpacing: ".1px" }}>{label}</b><span style={{ color: V.pri, marginLeft: 4 }}>*</span></span>
      {children}
      {hint && <span style={s.hint(hintType)}>{hint}</span>}
    </div>
  );
}

function CardHeader({ title, sub, isAdmin }) {
  return (
    <>
      {isAdmin && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", border: `1px solid ${V.warn}`, background: "rgba(255,170,51,.12)", color: V.warn, borderRadius: 2, fontFamily: V.mono, fontSize: 12, fontWeight: 700, letterSpacing: ".8px", marginBottom: 14 }}>
          <span style={{ width: 6, height: 6, background: V.warn, display: "inline-block" }} />
          ADMIN
        </div>
      )}
      <div style={{ fontSize: 34, fontWeight: 800, color: isAdmin ? V.ink : V.pri, letterSpacing: "-.4px", lineHeight: 1 }}>Syncro{isAdmin ? " 관제 시스템" : ""}</div>
      <div style={{ marginTop: 11, fontFamily: V.mono, fontSize: 13, color: V.ink2, letterSpacing: "1.4px", textTransform: "uppercase" }}>{sub}</div>
      <div style={{ height: 1, background: "rgba(255,255,255,.10)", margin: "30px -54px 28px" }} />
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: V.ink, letterSpacing: ".2px" }}>{title}</span>
        <span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink3, letterSpacing: ".6px" }}>{title.toUpperCase().replace(/ /g, " ")}</span>
      </div>
    </>
  );
}

function Links({ items }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 22 }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center" }}>
          {i > 0 && <span style={{ color: "rgba(255,255,255,.18)", padding: "0 2px" }}>|</span>}
          <a style={s.link} onClick={item.onClick}>{item.label}</a>
        </span>
      ))}
    </div>
  );
}

// ── 로그인 ─────────────────────────────────────────────────────────────────────
function ScreenLogin({ onSuccess, onGo }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!userId || !password) { setErr("아이디와 비밀번호를 입력하세요."); return; }
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.role === "CIVIL") { setErr("민원 계정은 민원 신청 화면에서 로그인하세요."); return; }
        localStorage.setItem("ts_user", JSON.stringify({ userId: data.userId, name: data.name, role: data.role, isTempPw: data.isTempPw, email: data.email || "" }));
        onSuccess(data);
      } else {
        setErr(data.message);
      }
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="아이디">
        <input style={s.inp} type="text" placeholder="parkjs" value={userId} onChange={e => setUserId(e.target.value)} />
      </Field>
      <Field label="비밀번호">
        <input style={s.inp} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      {err && <span style={s.hint("err")}>{err}</span>}
      <button style={s.btn(false)} type="submit" disabled={loading}>{loading ? "로그인 중..." : "로그인"}</button>
      <Links items={[
        { label: "아이디 찾기", onClick: () => onGo("findid") },
        { label: "비밀번호 찾기", onClick: () => onGo("findpw") },
        { label: "회원가입", onClick: () => onGo("signup") },
      ]} />
    </form>
  );
}

// ── 회원가입 ───────────────────────────────────────────────────────────────────
function ScreenSignup({ onGo }) {
  const [form, setForm] = useState({ userId: "", password: "", pwConfirm: "", name: "", phone: "", email: "", alertEmail: true });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.userId || !form.password || !form.name || !form.phone || !form.email) { setErr("모든 필드를 입력하세요."); return; }
    if (form.password !== form.pwConfirm) { setErr("비밀번호가 일치하지 않습니다."); return; }
    setLoading(true); setErr(""); setOk("");
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: form.userId, password: form.password, name: form.name, phone: form.phone, email: form.email, alertEmail: form.alertEmail ? 1 : 0 }),
      });
      const data = await res.json();
      if (data.success) setOk(data.message);
      else setErr(data.message);
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setLoading(false); }
  };

  const pwMatch = form.pwConfirm && form.password === form.pwConfirm;
  const pwMismatch = form.pwConfirm && form.password !== form.pwConfirm;

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="아이디"><input style={{ ...s.inp, height: 40, fontSize: 14 }} type="text" placeholder="영문 4~16자" value={form.userId} onChange={set("userId")} /></Field>
      <Field label="비밀번호"><input style={{ ...s.inp, height: 40, fontSize: 14 }} type="password" placeholder="8자 이상" value={form.password} onChange={set("password")} /></Field>
      <Field label="비밀번호 확인" hint={pwMatch ? "비밀번호가 일치합니다" : pwMismatch ? "비밀번호가 일치하지 않습니다" : ""} hintType={pwMatch ? "ok" : "err"}>
        <input style={{ ...s.inp, height: 40, fontSize: 14 }} type="password" placeholder="다시 입력" value={form.pwConfirm} onChange={set("pwConfirm")} />
      </Field>
      <Field label="이름"><input style={{ ...s.inp, height: 40, fontSize: 14 }} type="text" placeholder="박재성" value={form.name} onChange={set("name")} /></Field>
      <Field label="전화번호"><input style={{ ...s.inp, height: 40, fontSize: 14 }} type="tel" placeholder="010-1234-5678" value={form.phone} onChange={set("phone")} /></Field>
      <Field label="이메일"><input style={{ ...s.inp, height: 40, fontSize: 14 }} type="email" placeholder="park@example.com" value={form.email} onChange={set("email")} /></Field>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "9px 12px", background: "rgba(255,255,255,.05)", border: `1px solid rgba(255,255,255,.13)`, borderRadius: 2 }}>
        <input type="checkbox" checked={form.alertEmail} onChange={set("alertEmail")} style={{ display: "none" }} id="alert-chk" />
        <span style={{ width: 14, height: 14, border: `1px solid ${V.bd2}`, background: form.alertEmail ? V.pri : "transparent", borderColor: form.alertEmail ? V.pri : V.bd2, borderRadius: 2, flexShrink: 0, display: "grid", placeItems: "center" }}>
          {form.alertEmail && <span style={{ width: 7, height: 3.5, borderLeft: `2px solid #000`, borderBottom: `2px solid #000`, transform: "rotate(-45deg) translate(1px,-1px)", display: "block" }} />}
        </span>
        <span style={{ fontSize: 12.5, color: V.ink2, fontWeight: 500 }}>교통 알림 메일 수신</span>
      </label>
      {err && <span style={s.hint("err")}>{err}</span>}
      {ok  && <span style={s.hint("ok")}>{ok}</span>}
      <button style={{ ...s.btn(false), height: 46, fontSize: 14.5 }} type="submit" disabled={loading}>{loading ? "처리 중..." : "회원가입 신청"}</button>
      <p style={s.note}>가입 신청 후 관리자 승인 완료 시 로그인 가능합니다</p>
      <Links items={[{ label: "로그인으로 돌아가기", onClick: () => onGo("login") }]} />
    </form>
  );
}

// ── 아이디 찾기 ────────────────────────────────────────────────────────────────
function ScreenFindId({ onGo }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(""); setResult(null);
    try {
      const res = await fetch(`${API}/api/auth/find-id?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (data.success) setResult(data);
      else setErr(data.message);
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="이름"><input style={s.inp} type="text" placeholder="박재성" value={name} onChange={e => setName(e.target.value)} /></Field>
      <Field label="전화번호"><input style={s.inp} type="tel" placeholder="010-1234-5678" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
      {err && <span style={s.hint("err")}>{err}</span>}
      <button style={s.btn(false)} type="submit">조회</button>
      {result && (
        <div style={{ marginTop: 6, padding: "13px 16px", background: "rgba(255,255,255,.04)", border: `1px solid rgba(255,255,255,.1)`, borderRadius: 2, display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: V.mono, fontSize: 10.5, color: V.ok, fontWeight: 700, letterSpacing: ".6px" }}>RESULT</span>
          <span style={{ fontFamily: V.mono, fontSize: 18, fontWeight: 700, color: V.pri, letterSpacing: ".3px" }}>{result.userId}</span>
          <span style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 10.5, color: V.ink4 }}>{result.createdAt}</span>
        </div>
      )}
      <Links items={[{ label: "로그인으로 돌아가기", onClick: () => onGo("login") }]} />
    </form>
  );
}

// ── 비밀번호 찾기 ──────────────────────────────────────────────────────────────
function ScreenFindPw({ onGo }) {
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(""); setOk(""); setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/find-pw`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, email }),
      });
      const data = await res.json();
      if (data.success) setOk(data.message);
      else setErr(data.message);
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="아이디"><input style={s.inp} type="text" placeholder="parkjs" value={userId} onChange={e => setUserId(e.target.value)} /></Field>
      <Field label="이메일"><input style={s.inp} type="email" placeholder="park@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      {err && <span style={s.hint("err")}>{err}</span>}
      {ok  && <span style={s.hint("ok")}>{ok}</span>}
      <button style={s.btn(false)} type="submit" disabled={loading}>{loading ? "발송 중..." : "임시 비밀번호 발송"}</button>
      <p style={s.note}>입력한 이메일로 임시 비밀번호가 발송됩니다</p>
      <Links items={[{ label: "로그인으로 돌아가기", onClick: () => onGo("login") }]} />
    </form>
  );
}

// ── 관리자 로그인 ──────────────────────────────────────────────────────────────
function ScreenAdminLogin({ onAdminSuccess, onGo }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password }),
      });
      const data = await res.json();
      if (data.success && data.role === "ADMIN") {
        onAdminSuccess();
      } else if (data.success) {
        setErr("관리자 권한이 없습니다.");
      } else {
        setErr(data.message);
      }
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="관리자 아이디"><input style={s.inp} type="text" placeholder="admin" value={userId} onChange={e => setUserId(e.target.value)} /></Field>
      <Field label="비밀번호"><input style={s.inp} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} /></Field>
      {err && <span style={s.hint("err")}>{err}</span>}
      <button style={s.btn(true)} type="submit" disabled={loading}>{loading ? "인증 중..." : "관리자 로그인"}</button>
      <p style={s.note}>관리자 전용 인증 페이지입니다</p>
      <Links items={[{ label: "일반 로그인으로", onClick: () => onGo("login") }]} />
    </form>
  );
}

// ── 관리자 승인 페이지 ─────────────────────────────────────────────────────────
function ScreenApproval({ onBack }) {
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(new Date());

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API}/api/auth/admin/users`);
      setUsers(await res.json());
    } catch {}
  };

  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const fmt = n => String(n).padStart(2, "0");
  const timeStr = `${now.getFullYear()}-${fmt(now.getMonth()+1)}-${fmt(now.getDate())} ${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;

  const counts = { pending: 0, approved: 0, rejected: 0, all: users.length };
  users.forEach(u => { if (u.status?.toLowerCase() === "pending") counts.pending++; else if (u.status?.toLowerCase() === "approved") counts.approved++; else if (u.status?.toLowerCase() === "rejected") counts.rejected++; });

  const filtered = users.filter(u => {
    const st = u.status?.toLowerCase();
    const matchFilter = filter === "all" || st === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || u.name?.toLowerCase().includes(q) || u.userId?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  const handleApprove = async (userId) => {
    await fetch(`${API}/api/auth/admin/approve/${userId}`, { method: "POST" });
    fetchUsers();
  };
  const handleReject = async (userId) => {
    await fetch(`${API}/api/auth/admin/reject/${userId}`, { method: "POST" });
    fetchUsers();
  };

  const statusColor = { pending: V.warn, approved: V.ok, rejected: V.err };
  const filterLabels = { pending: `대기 (${counts.pending})`, approved: `승인 (${counts.approved})`, rejected: `거절 (${counts.rejected})`, all: `전체 (${counts.all})` };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10, background: V.bg, display: "flex", flexDirection: "column", fontFamily: V.sans }}>
      {/* 상단 헤더 */}
      <div style={{ height: 54, display: "flex", alignItems: "center", gap: 16, padding: "0 20px", borderBottom: `1px solid ${V.bd}`, background: "#0a0a0a" }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: V.ink }}>회원가입 승인</span>
        <span style={{ color: V.ink4, fontFamily: V.mono, fontSize: 13 }}>│</span>
        <span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink3 }}>관리자 · admin@syncro</span>
        <span style={{ color: V.ink4, fontFamily: V.mono, fontSize: 13 }}>│</span>
        <span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink3 }}>{timeStr.substring(0, 10)}</span>
        <div style={{ marginLeft: "auto", display: "flex" }}>
          {[["pending", "대기", V.warn], ["approved", "승인", V.ok], ["rejected", "거절", V.err], ["all", "전체", V.ink2]].map(([key, label, color]) => (
            <div key={key} style={{ padding: "0 18px", borderLeft: `1px solid ${V.bd}`, fontFamily: V.mono, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, color: V.ink3 }}>
              {label} <b style={{ fontSize: 17, color }}>{counts[key]}</b>
            </div>
          ))}
        </div>
      </div>

      {/* 툴바 */}
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderBottom: `1px solid ${V.bd}`, background: V.bg }}>
        <span style={{ fontFamily: V.mono, fontSize: 12, color: V.ink4, letterSpacing: ".5px" }}>FILTER</span>
        <div style={{ display: "flex", background: "#0a0a0a", border: `1px solid ${V.bd}`, borderRadius: 2 }}>
          {Object.entries(filterLabels).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} style={{ background: filter === key ? "#141414" : "transparent", border: 0, borderRight: `1px solid ${V.bd}`, color: filter === key ? V.ink : V.ink3, padding: "7px 16px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: V.mono }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", height: 30, display: "flex", alignItems: "center", gap: 10, padding: "0 12px", background: "#0a0a0a", border: `1px solid ${V.bd}`, borderRadius: 2, minWidth: 280 }}>
          <span style={{ fontFamily: V.mono, color: V.ink4, fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름, 아이디, 이메일 검색" style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: V.ink, fontSize: 14.5, fontFamily: V.sans }} />
        </div>
      </div>

      {/* 테이블 */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              {["이름", "아이디", "이메일", "가입일시", "상태", "처리"].map((h, i) => (
                <th key={h} style={{ position: "sticky", top: 0, background: "#0a0a0a", borderBottom: `1px solid ${V.bd}`, textAlign: i === 5 ? "right" : "left", fontFamily: V.mono, fontSize: 12.5, fontWeight: 700, color: V.ink3, letterSpacing: ".5px", textTransform: "uppercase", padding: "12px 16px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => {
              const st = u.status?.toLowerCase();
              const color = statusColor[st] || V.ink3;
              return (
                <tr key={u.userId}>
                  {[u.name, u.userId, u.email, u.createdAt?.substring(0, 16)?.replace("T", " ") || "-"].map((v, j) => (
                    <td key={j} style={{ padding: "13px 16px", borderBottom: `1px solid ${V.bd}`, background: i % 2 === 0 ? "rgba(255,255,255,.02)" : "#000", color: j === 0 ? V.ink : j === 1 ? V.ink : V.ink2, fontWeight: j < 2 ? 600 : 500, fontFamily: j >= 2 ? V.mono : V.sans, fontSize: j >= 2 ? 13 : 15 }}>{v}</td>
                  ))}
                  <td style={{ padding: "13px 16px", borderBottom: `1px solid ${V.bd}`, background: i % 2 === 0 ? "rgba(255,255,255,.02)" : "#000" }}>
                    <span style={{ fontFamily: V.mono, fontSize: 13.5, fontWeight: 700, letterSpacing: ".5px", color }}>{u.status?.toUpperCase()}</span>
                  </td>
                  <td style={{ padding: "13px 16px", borderBottom: `1px solid ${V.bd}`, background: i % 2 === 0 ? "rgba(255,255,255,.02)" : "#000", textAlign: "right" }}>
                    {st === "pending" ? (
                      <span style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                        <button onClick={() => handleApprove(u.userId)} style={{ padding: "5px 12px", background: "transparent", border: 0, color: V.ok, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: V.sans }}>승인</button>
                        <button onClick={() => handleReject(u.userId)}  style={{ padding: "5px 12px", background: "transparent", border: 0, color: V.err, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: V.sans }}>거절</button>
                      </span>
                    ) : (
                      <button onClick={() => {}} style={{ padding: "5px 12px", background: "transparent", border: 0, color: V.ink3, fontSize: 14, cursor: "pointer", fontFamily: V.sans }}>상태 변경</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 하단 */}
      <div style={{ height: 42, display: "flex", alignItems: "center", padding: "0 20px", borderTop: `1px solid ${V.bd}`, background: "#0a0a0a", fontFamily: V.mono, fontSize: 13, color: V.ink3, letterSpacing: ".3px" }}>
        <a onClick={onBack} style={{ marginRight: 14, color: V.ink4, cursor: "pointer", letterSpacing: ".3px" }}>← 로그인 페이지</a>
        <span>총 {filtered.length}건</span>
      </div>
    </div>
  );
}

// ── 메인 LoginPage ─────────────────────────────────────────────────────────────
export default function LoginPage({ onLoginSuccess, onCivil }) {
  const [screen, setScreen] = useState("login");
  const [isAdmin, setIsAdmin] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const fmt = n => String(n).padStart(2, "0");
  const timeStr = `${now.getFullYear()}-${fmt(now.getMonth()+1)}-${fmt(now.getDate())} ${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;

  if (screen === "approval") return <ScreenApproval onBack={() => setScreen("login")} />;

  const isMobile = window.innerWidth <= 768;
  const cardStyle = {
    width: 570, maxWidth: "100%",
    background: isAdmin ? "rgba(14,11,7,.42)" : V.card,
    backdropFilter: "blur(20px) saturate(1.05)",
    WebkitBackdropFilter: "blur(20px) saturate(1.05)",
    border: `1px solid ${isAdmin ? "rgba(255,170,51,.22)" : "rgba(255,200,140,.10)"}`,
    borderRadius: 2,
    padding: isMobile ? "28px 20px" : screen === "signup" ? "36px 44px" : "48px 54px",
  };

  const screenTitles = { login: ["로그인", "SEOUL TRAFFIC CONTROL SYSTEM"], signup: ["회원가입", "SEOUL TRAFFIC CONTROL SYSTEM"], findid: ["아이디 찾기", "SEOUL TRAFFIC CONTROL SYSTEM"], findpw: ["비밀번호 찾기", "SEOUL TRAFFIC CONTROL SYSTEM"], admin: ["관리자 로그인", "ADMIN AUTHENTICATION"] };
  const [title, sub] = screenTitles[screen] || ["로그인", "SEOUL TRAFFIC CONTROL SYSTEM"];

  return (
    <div style={{ fontFamily: V.sans, background: V.bg, color: V.ink, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* status bar */}
      <header style={{ height: 28, display: window.innerWidth <= 768 ? "none" : "flex", alignItems: "center", gap: 16, padding: "0 16px", background: "#0a0a0a", borderBottom: `1px solid ${V.bd}`, fontFamily: V.mono, fontSize: 11, color: V.ink3, letterSpacing: ".3px", zIndex: 30, flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, background: V.ok, display: "inline-block" }} />
        <span>Syncro AUTH SERVER · 정상</span>
        <span style={{ color: V.ink4 }}>│</span>
        <span>SECURE TLS 1.3</span>
        <span style={{ color: V.ink4 }}>│</span>
        <span>SESSION INACTIVE</span>
        <span style={{ marginLeft: "auto", color: V.ink2 }}>{timeStr}</span>
      </header>

      {/* body */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* 배경 영상 */}
        <video autoPlay muted loop playsInline src="/assets/bg.mp4"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0, filter: "saturate(.6) brightness(.55) contrast(1.05)" }}
        />
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: "radial-gradient(ellipse at center, rgba(0,0,0,.25) 0%, rgba(0,0,0,.55) 70%, rgba(0,0,0,.75) 100%)" }} />
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: .18, background: "linear-gradient(rgba(78,166,255,.18) 1px,transparent 1px) 0 0/48px 48px, linear-gradient(90deg,rgba(78,166,255,.18) 1px,transparent 1px) 0 0/48px 48px" }} />

        {/* 코너 텍스트 */}
        <div style={{ position: "absolute", top: 24, left: 42, zIndex: 3, fontFamily: V.mono, fontSize: 10.5, color: "rgba(255,255,255,.55)", letterSpacing: ".5px" }}>
          <b style={{ color: "#fff", fontWeight: 600, marginRight: 6 }}>SEOUL</b>37.566 °N · 126.978 °E
        </div>
        <div style={{ position: "absolute", top: 24, right: 42, zIndex: 3, fontFamily: V.mono, fontSize: 10.5, color: "rgba(255,255,255,.55)", letterSpacing: ".5px", textAlign: "right", display: "flex", flexDirection: "column", gap: 3 }}>
          <span>CCTV NET · 240 / 256 ACTIVE</span>
          <span>V2X LINK · 78 / 80 ONLINE</span>
        </div>
        <div style={{ position: "absolute", bottom: 24, left: 42, zIndex: 3 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: ".4px" }}>서울특별시 교통정보센터</div>
          <div style={{ marginTop: 6, fontFamily: V.mono, fontSize: 10.5, color: "rgba(255,255,255,.55)", letterSpacing: ".6px", textTransform: "uppercase" }}>— Seoul Metropolitan Traffic Center</div>
        </div>

        {/* 카드 */}
        <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 12 : 24, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%" }}>
            <div style={cardStyle}>
              <CardHeader title={title} sub={sub} isAdmin={screen === "admin"} />
              {screen === "login"   && <ScreenLogin    onSuccess={onLoginSuccess} onGo={setScreen} />}
              {screen === "signup"  && <ScreenSignup   onGo={setScreen} />}
              {screen === "findid"  && <ScreenFindId   onGo={setScreen} />}
              {screen === "findpw"  && <ScreenFindPw   onGo={setScreen} />}
              {screen === "admin"   && <ScreenAdminLogin onAdminSuccess={() => setScreen("approval")} onGo={setScreen} />}
            </div>

            {/* 관리자 / 민원 링크 (로그인 화면에서만) */}
            {screen === "login" && (
              <div style={{ display: "flex", gap: 8 }}>
                <a onClick={() => setScreen("admin")} style={{ fontFamily: V.mono, fontSize: 13, color: "rgba(255,255,255,.45)", letterSpacing: ".5px", padding: "8px 18px", cursor: "pointer" }}>
                  관리자 페이지 →
                </a>
                <a onClick={onCivil} style={{ fontFamily: V.mono, fontSize: 13, color: "rgba(255,170,51,.65)", letterSpacing: ".5px", padding: "8px 18px", cursor: "pointer" }}>
                  민원 페이지 →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* footer */}
      <footer style={{ height: 24, display: window.innerWidth <= 768 ? "none" : "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", background: "#0a0a0a", borderTop: `1px solid ${V.bd}`, fontFamily: V.mono, fontSize: 11, color: V.ink4, letterSpacing: ".3px", flexShrink: 0 }}>
        <span>Syncro · v2.4.0 · © 2026 서울특별시 교통정보센터</span>
        <span>비인가 접근 금지 · 모든 활동은 감사 로그에 기록됨</span>
      </footer>
    </div>
  );
}
