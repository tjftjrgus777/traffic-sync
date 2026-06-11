import { useState, useEffect } from "react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/+$/, "");

const V = {
  bg0:  "var(--bg0)",
  bg1:  "var(--bg1)",
  line: "var(--line)",
  bd2:  "var(--line2)",
  ink0: "var(--ink0)",
  ink1: "var(--ink1)",
  ink2: "var(--ink2)",
  ink3: "var(--ink3)",
  grn:  "var(--grn)",
  red:  "var(--red)",
  blu:  "var(--blu)",
  org:  "var(--org)",
  mono: "'IBM Plex Mono',ui-monospace,Menlo,monospace",
  sans: "'Pretendard','Noto Sans KR',system-ui,sans-serif",
};

// 토글 스위치
function Toggle({ on, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 44, height: 24, borderRadius: 12,
        background: on ? V.grn : V.bg1,
        border: `1px solid ${on ? V.grn : V.bd2}`,
        position: "relative", cursor: disabled ? "default" : "pointer",
        transition: "background .2s, border-color .2s", flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3,
        left: on ? 22 : 3,
        width: 16, height: 16, borderRadius: "50%",
        background: on ? "var(--bg0)" : V.ink2,
        transition: "left .2s",
      }} />
    </div>
  );
}

// 섹션 카드
function Section({ title, children }) {
  return (
    <div style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "20px 24px" }}>
      <div style={{ fontFamily: V.mono, fontSize: 10.5, color: V.ink2, letterSpacing: ".6px", textTransform: "uppercase", marginBottom: 16 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// 행 아이템
function Row({ label, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${V.line}` }}>
      <div>
        <div style={{ fontSize: 14, color: V.ink0, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: V.ink2, marginTop: 3, fontFamily: V.mono }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export default function MyPage({ onBack }) {
  const stored = JSON.parse(localStorage.getItem("ts_user") || "{}");
  const [user, setUser]           = useState(null);
  const [alertOn, setAlertOn]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState("");
  const [pwForm, setPwForm]       = useState({ cur: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg]         = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [time, setTime]           = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 유저 정보 로드
  useEffect(() => {
    if (!stored.userId) return;
    fetch(`${API}/api/auth/admin/users`)
      .then(r => r.json())
      .then(list => {
        const me = list.find(u => u.userId === stored.userId);
        if (me) { setUser(me); setAlertOn(me.alertEmail === 1); }
      })
      .catch(() => {});
  }, []);

  // 알림 토글 저장
  const handleToggle = async (val) => {
    setAlertOn(val); setSaving(true); setMsg("");
    try {
      const res = await fetch(`${API}/api/auth/alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: stored.userId, alertEmail: val ? 1 : 0 }),
      });
      const data = await res.json();
      setMsg(data.success ? (val ? "알림이 활성화되었습니다." : "알림이 비활성화되었습니다.") : "저장 실패");
    } catch { setAlertOn(!val); setMsg("서버 오류가 발생했습니다."); }
    finally { setSaving(false); setTimeout(() => setMsg(""), 3000); }
  };

  // 비밀번호 변경
  const handlePwChange = async (e) => {
    e.preventDefault();
    if (!pwForm.cur || !pwForm.next || !pwForm.confirm) { setPwMsg("모든 항목을 입력하세요."); return; }
    if (pwForm.next !== pwForm.confirm) { setPwMsg("새 비밀번호가 일치하지 않습니다."); return; }
    setPwLoading(true); setPwMsg("");
    try {
      const res = await fetch(`${API}/api/auth/change-pw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: stored.userId, currentPassword: pwForm.cur, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (data.success) {
        setPwMsg("비밀번호가 변경되었습니다.");
        setPwForm({ cur: "", next: "", confirm: "" });
        const updated = { ...stored, isTempPw: 0 };
        localStorage.setItem("ts_user", JSON.stringify(updated));
      } else {
        setPwMsg(data.message);
      }
    } catch { setPwMsg("서버 오류가 발생했습니다."); }
    finally { setPwLoading(false); }
  };

  const fmt = n => String(n).padStart(2, "0");
  const timeStr = `${time.getFullYear()}-${fmt(time.getMonth()+1)}-${fmt(time.getDate())} ${fmt(time.getHours())}:${fmt(time.getMinutes())}:${fmt(time.getSeconds())}`;

  const inpStyle = {
    width: "100%", height: 42, padding: "0 14px",
    background: "rgba(128,128,128,.08)", border: `1px solid ${V.bd2}`,
    borderRadius: 2, color: V.ink0, fontSize: 14, fontFamily: V.sans,
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ fontFamily: V.sans, background: V.bg0, color: V.ink0, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* 헤더 */}
      <div style={{ background: V.bg0, borderBottom: `1px solid ${V.line}`, padding: "0 24px", height: 56, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: V.bg1, border: `1px solid ${V.line}`, borderRadius: 2, padding: "5px 13px", color: V.ink1, fontSize: 13, cursor: "pointer", fontFamily: V.sans }}>
          ← 대시보드
        </button>
        <span style={{ fontSize: 16, fontWeight: 700, color: V.ink0 }}>마이페이지</span>
        <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink3 }}>MY PAGE</span>
        <div style={{ marginLeft: "auto", fontFamily: V.mono, fontSize: 12, color: V.ink2 }}>{timeStr}</div>
      </div>

      {/* 바디 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 0" }}>
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 계정 정보 */}
          <Section title="계정 정보">
            <Row label="아이디" right={<span style={{ fontFamily: V.mono, fontSize: 13, color: V.ink1 }}>{user?.userId || stored.userId || "—"}</span>} />
            <Row label="이름" right={<span style={{ fontSize: 13, color: V.ink1 }}>{user?.name || stored.name || "—"}</span>} />
            <Row label="이메일" right={<span style={{ fontFamily: V.mono, fontSize: 12, color: V.ink1 }}>{user?.email || "—"}</span>} />
            <Row
              label="계정 상태"
              right={
                <span style={{ fontFamily: V.mono, fontSize: 11.5, fontWeight: 700, color: user?.status === "APPROVED" ? V.grn : user?.status === "PENDING" ? V.org : V.red }}>
                  {user?.status || "—"}
                </span>
              }
            />
            <div style={{ padding: "12px 0" }}>
              <div style={{ fontSize: 14, color: V.ink0, fontWeight: 500 }}>역할</div>
              <div style={{ marginTop: 3, fontSize: 11.5, color: V.ink2, fontFamily: V.mono }}>
                {user?.role === "ADMIN" ? "관리자" : "일반 사용자"}
              </div>
            </div>
          </Section>

          {/* 알림 설정 */}
          <Section title="알림 설정">
            <Row
              label="교통 알림 메일 수신"
              sub={alertOn ? `${user?.email || "등록된 이메일"}으로 병목 경보 수신 중` : "병목 발생 시 메일 알림 꺼짐"}
              right={<Toggle on={alertOn} onChange={handleToggle} disabled={saving} />}
            />
            {msg && (
              <div style={{ marginTop: 10, fontFamily: V.mono, fontSize: 11.5, color: msg.includes("오류") || msg.includes("실패") ? V.red : V.grn }}>
                {msg}
              </div>
            )}
          </Section>

          {/* 비밀번호 변경 */}
          <Section title="비밀번호 변경">
            {stored.isTempPw === 1 && (
              <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(255,170,51,.08)", border: `1px solid rgba(255,170,51,.3)`, borderRadius: 2, fontSize: 12, color: V.org, fontFamily: V.mono }}>
                임시 비밀번호로 로그인 중입니다. 비밀번호를 변경해주세요.
              </div>
            )}
            <form onSubmit={handlePwChange} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                ["현재 비밀번호", "cur", "현재 비밀번호 입력"],
                ["새 비밀번호",   "next", "새 비밀번호 입력"],
                ["새 비밀번호 확인", "confirm", "새 비밀번호 재입력"],
              ].map(([label, key, placeholder]) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: V.mono, fontSize: 11, color: V.ink2, letterSpacing: ".4px", textTransform: "uppercase" }}>{label}</span>
                  <input
                    type="password"
                    placeholder={placeholder}
                    value={pwForm[key]}
                    onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))}
                    style={inpStyle}
                  />
                </div>
              ))}
              {pwMsg && (
                <span style={{ fontFamily: V.mono, fontSize: 11.5, color: pwMsg.includes("변경되었습니다") ? V.grn : V.red }}>
                  {pwMsg}
                </span>
              )}
              <button
                type="submit"
                disabled={pwLoading}
                style={{ height: 42, background: V.blu, border: "none", borderRadius: 2, color: "var(--bg0)", fontSize: 14, fontWeight: 700, cursor: pwLoading ? "default" : "pointer", fontFamily: V.sans, marginTop: 4 }}
              >
                {pwLoading ? "변경 중..." : "비밀번호 변경"}
              </button>
            </form>
          </Section>

        </div>
      </div>
    </div>
  );
}
