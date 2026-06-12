"""
MCP 서버 — Spring Boot API (http://localhost:8080) 를 MCP 도구로 노출
stdio 방식으로 실행, LangChain MCP 어댑터와 연동

[ 동작 원리 ]
1. agent_server.py 가 이 파일을 subprocess(별도 프로세스)로 실행
2. 두 프로세스가 stdin/stdout 으로 JSON 메시지를 주고받음 (stdio transport)
3. LLM이 "이 도구 써야겠다" 판단 → LangGraph가 이 서버에 요청 → 실제 Spring API 호출
"""

import asyncio          # 파이썬 비동기 처리 (async/await) 기본 라이브러리
import json             # dict → JSON 문자열 변환 (LLM에게 결과 돌려줄 때 사용)
import httpx            # 비동기 HTTP 클라이언트 (Spring API 호출에 사용, requests의 async 버전)
import smtplib          # Gmail SMTP 전송
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from mcp.server import Server                   # MCP 서버 객체 (도구 등록·실행 담당)
from mcp.server.stdio import stdio_server       # stdin/stdout 기반 통신 처리
from mcp.types import Tool, TextContent         # Tool: 도구 스펙 정의, TextContent: 응답 포맷

# ── 외부 서버 주소 상수 ─────────────────────────────────────────────────────────
SPRING_BASE = "http://localhost:8080"           # Spring Boot 백엔드 주소
ANYTHINGLLM_BASE = "http://localhost:3001"      # AnythingLLM RAG 서버 주소
ANYTHINGLLM_API_KEY = "EEZ2246-Z5JM2NG-K9XSXQ3-CNKF9W7"  # AnythingLLM 인증 키

# ── Gmail 설정 ──────────────────────────────────────────────────────────────────
GMAIL_SENDER   = "juya0947@gmail.com"       # 보내는 Gmail 주소 (본인 계정)
GMAIL_APP_PWD  = "hgma peeg rfbm sboq"  # Gmail 앱 비밀번호 (16자리)
GMAIL_DEFAULT_TO = "juya0947@gmail.com"     # 기본 수신자 (미지정 시 여기로)

# MCP 서버 인스턴스 생성. "traffic-mcp-server"는 이 서버의 식별 이름
app = Server("traffic-mcp-server")


# ── 도구 목록 정의 ──────────────────────────────────────────────────────────────
# @app.list_tools() → agent_server.py 시작 시 "어떤 도구들이 있어?" 요청이 오면
# 아래 함수가 실행돼서 도구 목록을 반환함
# LangGraph는 이 목록을 시스템 프롬프트에 넣어서 LLM에게 "이런 도구 쓸 수 있어" 알려줌
@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        # ── 도구 1: 특정 교차로 상세 조회 ───────────────────────────────────────
        Tool(
            name="get_traffic_data",
            description=(
                "특정 교차로의 실시간 교통 데이터를 조회합니다.\n"
                "반환 구조:\n"
                "- signals: 방향별 신호 맵. 키=nt(북직진)/et(동직진)/st(남직진)/wt(서직진)/ne/se/sw/nw(대각).\n"
                "  각 방향 안에 stsg(직진)·ltsg(좌회전)·pdsg(보행) 신호가 있으며,\n"
                "  status='stop-And-Remain'이면 적색, 'protected-Movement-Allowed'이면 녹색.\n"
                "  rmndCs=잔여시간(초 단위).\n"
                "- speedKph: 실측 구간 속도(km/h). null이면 미수집.\n"
                "- congestion: 원활/서행/혼잡/알 수 없음.\n"
                "- avgWaitSec: 전방향 평균 대기시간(초). 단순 요약용.\n"
                "★ 신호 최적화 판단 규칙 (반드시 준수):\n"
                "  rmndCs는 현재 상태의 잔여시간(스냅샷)이며 사이클 전체 시간이 아님.\n"
                "  [적색(stop-And-Remain) + rmndCs 높음] → 이 방향은 오래 기다려야 함 "
                "→ 이 방향의 적색을 단축(= set_signal_timing delay 음수)하거나 "
                "대향 방향 녹색을 단축해 순서를 앞당기도록 권고.\n"
                "  [녹색(protected-Movement-Allowed) + rmndCs 낮음] → 곧 적색 전환 "
                "→ 혼잡하면 녹색 연장(delay 양수) 고려.\n"
                "  set_signal_timing의 delay는 녹색 지속시간 조정값(양수=연장, 음수=단축)임.\n"
                "  단, rmndCs는 스냅샷이라 전체 사이클 길이를 알 수 없으므로 "
                "Webster 공식 적용 시 이 한계를 명시하고 권고 근거를 보수적으로 서술할 것.\n"
                "- riskIndex/riskGrade: 도로 위험 지수·등급.\n"
                "- weather: 기온(temperatureC)·강수량(precipitationMm)·습도·풍속."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    # LLM이 넘겨야 할 파라미터 정의
                    "crossroad_id": {"type": "string", "description": "교차로 ID (예: 1007)"}
                },
                "required": ["crossroad_id"]    # 필수 파라미터 (없으면 도구 호출 안 됨)
            }
        ),

        # ── 도구 2: 전체 병목 목록 조회 ─────────────────────────────────────────
        Tool(
            name="get_bottleneck_list",
            description="현재 수집된 모든 교차로의 신호 상태 목록을 조회합니다. 병목 구간 파악에 사용합니다.",
            inputSchema={
                "type": "object",
                "properties": {}                # 파라미터 없음 (전체 조회라서)
            }
        ),

        # ── 도구 3: 이름으로 교차로 검색 ────────────────────────────────────────
        Tool(
            name="search_crossroad_by_name",
            description="교차로 이름으로 교차로 ID를 검색합니다. 예: '잠실역' 입력 시 해당 교차로 ID 반환.",
            # LLM이 "잠실역 어때?" 질문을 받으면 crsrdId를 모르니까 이 도구로 먼저 검색
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "검색할 교차로 이름 (부분 일치)"}
                },
                "required": ["name"]
            }
        ),

        # ── 도구 4: 구 단위 교통 요약 ───────────────────────────────────────────
        Tool(
            name="get_district_traffic",
            description="서울 특정 자치구의 전체 교차로 교통 데이터를 조회합니다. 구 단위 분석에 사용합니다.",
            inputSchema={
                "type": "object",
                "properties": {
                    "district_name": {"type": "string", "description": "자치구 이름 (예: 강남구, 송파구)"}
                },
                "required": ["district_name"]
            }
        ),

        # ── 도구 5: 신호 타이밍 조정 ────────────────────────────────────────────
        Tool(
            name="set_signal_timing",
            description=(
    "특정 교차로의 신호 타이밍을 조정합니다. "
    "호출 전에 반드시 search_project_docs로 "
    "날씨·속도 기반 최적 신호 공식을 먼저 조회하고 "
    "그 근거를 바탕으로 delay 값을 결정하세요."
),
            # Human-in-the-loop: AI가 권고 → 관제사 승인 후 실제 적용 예정
            # 현재 Spring쪽 /api/signal/adjust 미구현이라 404 반환됨
            inputSchema={
                "type": "object",
                "properties": {
                    "crossroad_id": {"type": "string", "description": "교차로 ID"},
                    "delay": {"type": "integer", "description": "신호 연장 시간(초), 양수=연장, 음수=단축"}
                },
                "required": ["crossroad_id", "delay"]
            }
        ),

        # ── 도구 6: 관제사 알림 전송 ────────────────────────────────────────────
        Tool(
            name="send_alert",
            description="관리자에게 교통 상황 알림 메시지를 전송합니다.",
            # 현재는 콘솔 출력만 (향후 Slack/이메일 연동 가능)
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "전송할 알림 메시지"}
                },
                "required": ["message"]
            }
        ),

        # ── 도구 7: 이메일 리포트 전송 ──────────────────────────────────────────
        Tool(
            name="send_email_report",
            description=(
                "교통 리포트를 이메일로 전송합니다. "
                "반드시 사용자 질문에 '이메일', '메일', '메일로', '이메일로' 키워드가 명시된 경우에만 호출하세요. "
                "분석·최적화·리포트 요청이라도 이메일 키워드가 없으면 절대 호출 금지. "
                "to 필드에는 프롬프트에서 제공된 [요청 유저 이메일] 주소를 반드시 사용하세요."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "description": "이메일 제목"},
                    "body":    {"type": "string", "description": "리포트 본문"},
                    "to":      {"type": "string", "description": "수신자 이메일 주소. 반드시 프롬프트의 [요청 유저 이메일] 값을 사용할 것."}
                },
                "required": ["subject", "body", "to"]
            }
        ),

        # ── 도구 8: 시뮬레이션 페이지 신호계획 조회 ─────────────────────────────
        Tool(
            name="get_simulation_context",
            description=(
                "시뮬레이션 페이지에서 교차로를 클릭했을 때 신호계획 데이터를 조회합니다.\n"
                "반환 구조:\n"
                "- cycleVal: 전체 사이클(초). 이 값이 한 바퀴 도는 총 시간.\n"
                "- currentPhaseNo: 지금 켜져 있는 현시 번호 (1-based).\n"
                "- elapsed: 현재 사이클에서 경과한 시간(초).\n"
                "- phases[]: 현시 목록. 각 항목:\n"
                "  - phaseNo: 현시 번호\n"
                "  - seconds: 이 현시의 녹색 지속시간(초)\n"
                "  - isActive: 현재 이 현시가 켜져 있는지 여부\n"
                "  - directions[]: 이 현시에서 통행 허용 방향 목록\n"
                "    - ring: A 또는 B (동시에 켜지는 쌍)\n"
                "    - type: 직진/좌회전/보행/유턴/버스\n"
                "    - from: 출발 방위 (북/동/남/서/북동/남동/남서/북서)\n"
                "    - to: 도착 방위\n"
                "★ 신호 최적화 판단 규칙:\n"
                "  isActive=true 현시가 현재 켜진 방향. seconds가 작을수록 해당 방향 대기 시간이 짧아짐.\n"
                "  혼잡한 방향의 현시 seconds를 늘리거나, 비어있는 방향 seconds를 줄이도록 권고."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "int_no": {"type": "string", "description": "신호 교차로 ID (예: 2904). 시뮬레이션 페이지에서 클릭한 교차로."}
                },
                "required": ["int_no"]
            }
        ),

        # ── 도구 9: 프로젝트 문서 RAG 검색 ──────────────────────────────────────
        Tool(
            name="search_project_docs",
            description=(
                "프로젝트 문서(docs/)에서 관련 지식을 검색합니다. "
                "Webster 신호 최적화 공식, 날씨별 교통 영향, 병목 판단 기준, "
                "보안 아키텍처, 실행 방법 등 도메인 지식이 필요할 때 사용합니다."
            ),
            # AnythingLLM이 docs/ 마크다운을 벡터DB로 저장해두고
            # 질문과 유사한 내용을 찾아서 반환 (RAG: Retrieval Augmented Generation)
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "검색할 내용 (예: '비 올 때 신호 최적화 방법')"}
                },
                "required": ["query"]
            }
        ),
    ]


# ── 도구 실행 ───────────────────────────────────────────────────────────────────
# @app.call_tool() → LLM이 특정 도구를 선택하면 이 함수가 실행됨
# name: LLM이 선택한 도구 이름 (예: "get_traffic_data")
# arguments: LLM이 넘긴 파라미터 (예: {"crossroad_id": "1007"})
@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    # httpx.AsyncClient: 비동기 HTTP 클라이언트. timeout=10.0 → 10초 안에 응답 없으면 오류
    # "async with"로 사용 후 자동으로 연결 종료 (컨텍스트 매니저)
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            result = await _dispatch(client, name, arguments)   # 실제 도구별 로직 실행
        except httpx.ConnectError:
            # Spring Boot가 꺼져 있을 때 발생. 에이전트가 멈추지 않고 오류 메시지 반환
            result = {"error": "Spring Boot 서버(localhost:8080)에 연결할 수 없습니다."}
        except Exception as e:
            result = {"error": str(e)}

    # TextContent: MCP 프로토콜의 응답 포맷. type="text"로 JSON 문자열을 감싸서 반환
    # ensure_ascii=False → 한글이 \uXXXX 로 깨지지 않게
    # indent=2 → 보기 좋게 들여쓰기 (LLM이 읽기 쉽게)
    return [TextContent(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))]


# 도구별 실제 로직 분리. call_tool에서 이름에 따라 분기
# client를 파라미터로 받는 이유: httpx 클라이언트를 재사용해서 성능 최적화
async def _dispatch(client: httpx.AsyncClient, name: str, args: dict) -> dict:

    # ── get_traffic_data ────────────────────────────────────────────────────────
    if name == "get_traffic_data":
        cid = args["crossroad_id"]
        r = await client.get(f"{SPRING_BASE}/api/context/{cid}")
        if r.status_code == 404:
            return {"error": f"교차로 ID {cid} 를 찾을 수 없습니다."}
        data = r.json()
        # rmndCs는 V2X 원본이 1/10초 단위 → 초 단위로 변환해서 LLM에게 전달
        signals = data.get("signals") or {}
        for direction in signals.values():
            if not isinstance(direction, dict):
                continue
            for sg in direction.values():
                if isinstance(sg, dict) and "rmndCs" in sg:
                    sg["rmndCs"] = round(sg["rmndCs"] / 10, 1)
        return data

    # ── get_bottleneck_list ─────────────────────────────────────────────────────
    elif name == "get_bottleneck_list":
        r = await client.get(f"{SPRING_BASE}/api/signals")  # 전체 캐시 조회
        signals = r.json()                      # List[TrafficStatus]
        if isinstance(signals, list):
            def spd(x):
                v = x.get("speedKph")           # TrafficStatus.speedKph (flat double)
                return v if isinstance(v, (int, float)) and v > 0 else None

            valid = [s for s in signals if spd(s) is not None]
            valid.sort(key=spd)
            top10 = [
                {
                    "crsrdId": s.get("crsrdId", ""),
                    "name": s.get("crsrdNm", ""),
                    "speed_kmh": spd(s),
                    "risk_grade": s.get("riskGrade"),
                    "risk_index": s.get("riskIndex"),
                    "congestion": s.get("congestion"),
                }
                for s in valid[:10]
            ]
            risk_summary = {}
            for s in (signals if isinstance(signals, list) else []):
                grade = s.get("riskGrade") or "미수집"
                risk_summary[grade] = risk_summary.get(grade, 0) + 1
        else:
            top10 = []
            risk_summary = {}
        # 날씨는 전역 스냅샷 — 어느 교차로든 동일하므로 첫 항목에서 꺼냄
        weather = signals[0].get("weather") if isinstance(signals, list) and signals else None
        return {
            "top10_bottlenecks": top10,
            "total_count": len(signals) if isinstance(signals, list) else 0,
            "risk_summary": risk_summary,
            "weather": weather,
        }

    # ── search_crossroad_by_name ────────────────────────────────────────────────
    elif name == "search_crossroad_by_name":
        name_query = args["name"]               # 검색어 (예: "잠실")
        r = await client.get(f"{SPRING_BASE}/api/signals")
        signals = r.json() if r.status_code == 200 else []
        # 부분 일치 검색: "잠실역사거리"에 "잠실" 포함 → 매칭
        matched = [
            {"crsrdId": s.get("crsrdId"), "crsrdNm": s.get("crsrdNm"), "lat": s.get("lat"), "lon": s.get("lon")}
            for s in (signals if isinstance(signals, list) else [])
            if name_query in s.get("crsrdNm", "")  # 이름에 검색어 포함 여부
        ]
        if not matched:
            return {"error": f"'{name_query}' 이름의 교차로를 찾을 수 없습니다.", "results": []}
        return {"results": matched, "count": len(matched)}

    # ── get_district_traffic ────────────────────────────────────────────────────
    elif name == "get_district_traffic":
        district = args["district_name"]        # 예: "강남구"
        r = await client.get(f"{SPRING_BASE}/api/signals")
        signals = r.json() if r.status_code == 200 else []
        # 캐시는 이미 선택된 구의 교차로만 포함 → 전체 사용
        district_signals = signals if isinstance(signals, list) else []

        # 속도 추출 헬퍼: TrafficStatus.speedKph (flat double)
        def speed_of(s):
            v = s.get("speedKph")
            return v if isinstance(v, (int, float)) and v > 0 else 0

        speeds = [speed_of(s) for s in district_signals if speed_of(s) > 0]
        avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else 0

        sorted_by_speed = sorted(district_signals, key=speed_of)

        RISK_MAP = {"01": "안전", "02": "주의", "03": "위험", "04": "심각"}

        def map_risk(g):
            return RISK_MAP.get(str(g), g or "미수집")

        # 15km/h 이하 병목 교차로만 필터링
        bottleneck_under_15 = [
            {
                "name": s.get("crsrdNm", ""),
                "speed_kmh": speed_of(s),
                "risk_grade": map_risk(s.get("riskGrade")),
            }
            for s in sorted_by_speed
            if 0 < speed_of(s) <= 15
        ]

        weather = district_signals[0].get("weather") if district_signals else None
        return {
            "district": district,
            "total_crossroads": len(district_signals),
            "bottleneck_under_15": bottleneck_under_15,
            "weather": weather,
        }

    # ── set_signal_timing ───────────────────────────────────────────────────────
    elif name == "set_signal_timing":
        cid = args["crossroad_id"]
        delay = args["delay"]                   # 양수=연장, 음수=단축 (초 단위)
        r = await client.post(
            f"{SPRING_BASE}/api/signal/adjust",
            json={"crossroadId": cid, "delaySeconds": delay}
        )
        if r.status_code == 404:
            # Spring쪽 /api/signal/adjust 아직 미구현 → 404 반환
            return {"error": "신호 조정 API가 아직 구현되지 않았습니다."}
        return {"success": True, "crossroad_id": cid, "delay": delay, "status": r.status_code}

    # ── send_alert ──────────────────────────────────────────────────────────────
    elif name == "send_alert":
        message = args["message"]
        # flush=True: 버퍼 즉시 출력 (stdout이 stdio transport로 쓰이므로 버퍼 비워야 함)
        print(f"[ALERT] {message}", flush=True)
        return {"success": True, "message": message, "channel": "console"}

    # ── get_simulation_context ──────────────────────────────────────────────────
    elif name == "get_simulation_context":
        int_no = args["int_no"]
        r = await client.get(f"{SPRING_BASE}/api/signal/simulation/context/{int_no}")
        if r.status_code == 404:
            return {"error": f"교차로 intNo {int_no} 신호계획을 찾을 수 없습니다."}
        return r.json()

    # ── search_project_docs ─────────────────────────────────────────────────────
    elif name == "search_project_docs":
        query = args["query"]
        url = f"{ANYTHINGLLM_BASE}/api/v1/workspace/159a2d66-831c-4bb0-a851-0ee51dddb366/chat"
        # Bearer 토큰 인증: AnythingLLM이 요청자 검증에 사용
        headers = {"Authorization": f"Bearer {ANYTHINGLLM_API_KEY}", "Content-Type": "application/json"}
        try:
            # RAG 응답은 느릴 수 있어서 timeout=30.0 (기본 10초보다 길게)
            # 별도 클라이언트 생성: 기존 client는 timeout=10.0 이라서
            async with httpx.AsyncClient(timeout=30.0) as rag_client:
                r = await rag_client.post(
                    url,
                    headers=headers,
                    json={
                        "message": query,   # 검색할 내용
                        "mode": "query"     # "query"=검색 모드, "chat"=대화 모드
                    }
                )
            if r.status_code != 200:
                return {"error": f"AnythingLLM 오류 (status {r.status_code})", "query": query}
            # AnythingLLM 응답에서 실제 텍스트만 꺼냄
            text = r.json().get("textResponse", "")
            # qwen3 think 태그 제거
            if "</think>" in text:
                text = text.split("</think>")[-1].strip()
            return {"query": query, "result": text}
        except httpx.ConnectError:
            # AnythingLLM이 꺼져 있어도 에이전트 전체가 멈추지 않게 오류 메시지만 반환
            return {"error": "AnythingLLM 서버(localhost:3001)에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요."}

    # ── send_email_report ───────────────────────────────────────────────────────
    elif name == "send_email_report":
        # LLM이 넘기는 to 파라미터는 무시 — 프롬프트에 주입된 userEmail만 사용
        to      = args.get("to") or None
        subject = args["subject"]
        body    = args["body"]

        if not to:
            return {"error": "수신자 이메일이 없습니다. 로그인 후 다시 시도해주세요."}

        # SMTP 직접 호출 대신 Spring EmailService로 위임
        try:
            r = await client.post(
                f"{SPRING_BASE}/api/email/send",
                json={"to": to, "subject": subject, "body": body},
            )
            if r.status_code == 200:
                return {"success": True, "to": to, "subject": subject}
            return {"error": f"메일 발송 실패: HTTP {r.status_code}"}
        except Exception as e:
            return {"error": f"메일 발송 실패: {str(e)}"}

    # ── 알 수 없는 도구 ─────────────────────────────────────────────────────────
    else:
        return {"error": f"알 수 없는 도구: {name}"}


# ── 진입점 ──────────────────────────────────────────────────────────────────────
async def main():
    # stdio_server(): stdin에서 MCP 요청을 읽고 stdout으로 응답을 쓰는 스트림 생성
    # agent_server.py가 subprocess로 이 파일을 실행하면 여기서 대기
    async with stdio_server() as (read_stream, write_stream):
        # app.run(): MCP 프로토콜에 따라 요청을 받아서 list_tools / call_tool 라우팅
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    # asyncio.run(): 비동기 main() 함수를 동기 진입점에서 실행
    asyncio.run(main())
