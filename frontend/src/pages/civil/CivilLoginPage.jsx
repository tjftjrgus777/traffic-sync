import { useState, useEffect } from "react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

const V = {
  bg: "#000", card: "rgba(14,11,7,.35)",
  bd: "#1a1a1a", bd2: "#2a2a2a",
  ink: "#e7ecf5", ink2: "#aab4c8", ink3: "#7a7a7a", ink4: "#3a3a3a",
  pri: "#ffaa33", ok: "#2ee07a", err: "#ff5566",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR',system-ui,sans-serif",
};

const s = {
  inp: { width: "100%", height: 46, padding: "0 16px", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 2, color: V.ink, fontSize: 14, fontWeight: 500, fontFamily: V.sans, outline: "none", boxSizing: "border-box" },
  lab: { fontFamily: V.mono, fontSize: 11, color: V.ink3, letterSpacing: ".5px" },
  btn: (color) => ({ width: "100%", height: 52, border: "none", borderRadius: 2, background: color || V.pri, color: "#000", fontSize: 15, fontWeight: 700, letterSpacing: ".4px", cursor: "pointer", marginTop: 8, fontFamily: V.sans }),
  link: { color: V.ink2, fontSize: 13, fontWeight: 500, cursor: "pointer", padding: "0 12px" },
  hint: (type) => ({ fontSize: 11, fontFamily: V.mono, color: type === "ok" ? V.ok : V.err }),
};

function Field({ label, children, hint, hintType }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={s.lab}><b style={{ color: V.ink, fontWeight: 500, fontFamily: V.sans, fontSize: 13, textTransform: "none", letterSpacing: 0 }}>{label}</b><span style={{ color: V.pri, marginLeft: 3 }}>*</span></span>
      {children}
      {hint && <span style={s.hint(hintType)}>{hint}</span>}
    </div>
  );
}

function Links({ items }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 18 }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center" }}>
          {i > 0 && <span style={{ color: "rgba(255,255,255,.18)", padding: "0 2px" }}>|</span>}
          <a style={s.link} onClick={item.onClick}>{item.label}</a>
        </span>
      ))}
    </div>
  );
}

// ── 민원 로그인 ──────────────────────────────────────────────────────────────
function ScreenLogin({ onLogin, onGo }) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!userId || !password) { setErr("아이디와 비밀번호를 입력하세요."); return; }
    setLoading(true); setErr("");
    try {
      const res = await fetch(`${API}/api/civil/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password }),
      });
      const data = await res.json();
      if (data.success) {
        const user = { userId: data.userId, name: data.name };
        localStorage.setItem("ts_civil_user", JSON.stringify(user));
        onLogin(user);
      } else {
        setErr(data.message || "로그인에 실패했습니다.");
      }
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Field label="아이디">
        <input style={s.inp} type="text" placeholder="민원 아이디" value={userId} onChange={e => setUserId(e.target.value)} />
      </Field>
      <Field label="비밀번호">
        <input style={s.inp} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      {err && <span style={s.hint("err")}>{err}</span>}
      <button style={s.btn()} type="submit" disabled={loading}>{loading ? "로그인 중..." : "민원 로그인"}</button>
      <Links items={[
        { label: "회원가입", onClick: () => onGo("signup") },
      ]} />
    </form>
  );
}

// ── 민원 회원가입 (즉시 승인) ─────────────────────────────────────────────────
function ScreenSignup({ onGo }) {
  const [form, setForm] = useState({ userId: "", password: "", pwConfirm: "", name: "", phone: "", email: "" });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.userId || !form.password || !form.name || !form.phone || !form.email) { setErr("모든 필드를 입력하세요."); return; }
    if (form.userId.length < 4) { setErr("아이디는 4자 이상이어야 합니다."); return; }
    if (form.password.length < 8) { setErr("비밀번호는 8자 이상이어야 합니다."); return; }
    if (form.password !== form.pwConfirm) { setErr("비밀번호가 일치하지 않습니다."); return; }
    setLoading(true); setErr(""); setOk("");
    try {
      const res = await fetch(`${API}/api/civil/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: form.userId, password: form.password, name: form.name, phone: form.phone, email: form.email }),
      });
      const data = await res.json();
      if (data.success) {
        setOk("회원가입이 완료되었습니다. 로그인하세요.");
        setTimeout(() => onGo("login"), 2000);
      } else {
        setErr(data.message || "회원가입에 실패했습니다.");
      }
    } catch { setErr("서버 연결 오류가 발생했습니다."); }
    finally { setLoading(false); }
  };

  const pwMatch = form.pwConfirm && form.password === form.pwConfirm;
  const pwMismatch = form.pwConfirm && form.password !== form.pwConfirm;

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field label="아이디"><input style={{ ...s.inp, height: 40 }} type="text" placeholder="영문 4자 이상" value={form.userId} onChange={set("userId")} /></Field>
      <Field label="비밀번호"><input style={{ ...s.inp, height: 40 }} type="password" placeholder="8자 이상" value={form.password} onChange={set("password")} /></Field>
      <Field label="비밀번호 확인" hint={pwMatch ? "일치합니다" : pwMismatch ? "일치하지 않습니다" : ""} hintType={pwMatch ? "ok" : "err"}>
        <input style={{ ...s.inp, height: 40 }} type="password" placeholder="다시 입력" value={form.pwConfirm} onChange={set("pwConfirm")} />
      </Field>
      <Field label="이름"><input style={{ ...s.inp, height: 40 }} type="text" placeholder="홍길동" value={form.name} onChange={set("name")} /></Field>
      <Field label="전화번호"><input style={{ ...s.inp, height: 40 }} type="tel" placeholder="010-1234-5678" value={form.phone} onChange={set("phone")} /></Field>
      <Field label="이메일"><input style={{ ...s.inp, height: 40 }} type="email" placeholder="user@example.com" value={form.email} onChange={set("email")} /></Field>
      {err && <span style={s.hint("err")}>{err}</span>}
      {ok  && <span style={s.hint("ok")}>{ok}</span>}
      <button style={{ ...s.btn(), height: 44, fontSize: 14 }} type="submit" disabled={loading}>{loading ? "처리 중..." : "회원가입"}</button>
      <Links items={[{ label: "로그인으로 돌아가기", onClick: () => onGo("login") }]} />
    </form>
  );
}

// ── 메인 CivilLoginPage ───────────────────────────────────────────────────────
export default function CivilLoginPage({ onLogin, onBack }) {
  const [screen, setScreen] = useState("login");
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const fmt = n => String(n).padStart(2, "0");
  const timeStr = `${now.getFullYear()}-${fmt(now.getMonth()+1)}-${fmt(now.getDate())} ${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`;

  const titles = { login: "민원 로그인", signup: "민원 회원가입" };

  return (
    <div style={{ fontFamily: V.sans, background: V.bg, color: V.ink, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* status bar */}
      <header style={{ height: 28, display: window.innerWidth <= 768 ? "none" : "flex", alignItems: "center", gap: 16, padding: "0 16px", background: "#0a0a0a", borderBottom: `1px solid ${V.bd}`, fontFamily: V.mono, fontSize: 11, color: V.ink3, letterSpacing: ".3px", zIndex: 30, flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, background: V.pri, display: "inline-block" }} />
        <span>Syncro · 민원 시스템</span>
        <span style={{ color: V.ink4 }}>│</span>
        <span>시민 민원 접수 포털</span>
        <span style={{ marginLeft: "auto", color: V.ink2 }}>{timeStr}</span>
      </header>

      {/* body */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video autoPlay muted loop playsInline src="/assets/bg.mp4"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0, filter: "saturate(.6) brightness(.55) contrast(1.05)" }}
        />
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: "radial-gradient(ellipse at center, rgba(0,0,0,.25) 0%, rgba(0,0,0,.55) 70%, rgba(0,0,0,.75) 100%)" }} />
        <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: .15, background: "linear-gradient(rgba(255,170,51,.18) 1px,transparent 1px) 0 0/48px 48px, linear-gradient(90deg,rgba(255,170,51,.18) 1px,transparent 1px) 0 0/48px 48px" }} />

        <div style={{ position: "absolute", top: 24, left: 42, zIndex: 3, fontFamily: V.mono, fontSize: 10.5, color: "rgba(255,255,255,.55)", letterSpacing: ".5px" }}>
          <b style={{ color: "#fff", fontWeight: 600, marginRight: 6 }}>민원 포털</b>Syncro CITIZEN SERVICE
        </div>

        {/* 카드 */}
        <div style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%" }}>
            <div style={{ width: screen === "signup" ? 500 : 480, maxWidth: "100%", background: V.card, backdropFilter: "blur(20px) saturate(1.05)", WebkitBackdropFilter: "blur(20px) saturate(1.05)", border: "1px solid rgba(255,170,51,.22)", borderRadius: 2, padding: "clamp(20px, 5vw, 44px) clamp(16px, 6vw, 50px)" }}>

              {/* 헤더 */}
              <div style={{ fontSize: 30, fontWeight: 800, color: V.pri, letterSpacing: "-.3px", lineHeight: 1 }}>Syncro</div>
              <div style={{ marginTop: 8, fontFamily: V.mono, fontSize: 12, color: V.ink2, letterSpacing: "1.4px", textTransform: "uppercase" }}>서울시 교통 민원 포털</div>
              <div style={{ height: 1, background: "rgba(255,255,255,.10)", margin: "24px -40px 22px" }} />
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
                <span style={{ fontSize: 17, fontWeight: 600, color: V.ink }}>{titles[screen]}</span>
                <span style={{ fontFamily: V.mono, fontSize: 12, color: V.ink3 }}>{titles[screen].toUpperCase()}</span>
              </div>

              {screen === "login"  && <ScreenLogin  onLogin={onLogin} onGo={setScreen} />}
              {screen === "signup" && <ScreenSignup onGo={setScreen} />}
            </div>

            {/* 일반 로그인 링크 */}
            <a onClick={onBack} style={{ fontFamily: V.mono, fontSize: 12, color: "rgba(255,255,255,.4)", letterSpacing: ".5px", padding: "8px 18px", cursor: "pointer" }}>
              ← 관제 시스템으로 돌아가기
            </a>
          </div>
        </div>
      </div>

      <footer style={{ height: 24, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", background: "#0a0a0a", borderTop: `1px solid ${V.bd}`, fontFamily: V.mono, fontSize: 11, color: V.ink4, letterSpacing: ".3px", flexShrink: 0 }}>
        <span>Syncro CITIZEN · © 2026 서울특별시 교통정보센터</span>
        <span>민원 접수 내용은 처리 현황 관리에 기록됩니다</span>
      </footer>
    </div>
  );
}
