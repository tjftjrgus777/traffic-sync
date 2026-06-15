"""
AI 에이전트 서버 — FastAPI + LangGraph ReAct + Ollama (qwen3:30b-a3b) + MCP
포트: 8000

엔드포인트:
  POST /api/agent/chat          → 자유 챗봇 (지도 페이지)
  POST /api/agent/district-report → 구 단위 리포트 (메인 대시보드)
  GET  /health                  → 서버 상태 확인
"""

import sys
import os
import re
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import httpx
from ollama import AsyncClient as OllamaAsyncClient
from langchain_ollama import ChatOllama
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import AIMessage
from langgraph.prebuilt import create_react_agent

# ── 설정 ────────────────────────────────────────────────────────────────────────

OLLAMA_URL  = "http://localhost:11434"
OLLAMA_MODEL = "qwen2.5:14b"
MCP_SERVER_PATH = os.path.join(os.path.dirname(__file__), "mcp_server.py")
PYTHON_BIN  = sys.executable

# ── Ollama httpx 클라이언트 (stop 시 직접 닫기 위해 공유) ──────────────────────────

_ollama_client = OllamaAsyncClient(host=OLLAMA_URL)

# ── LLM & 에이전트 초기화 ────────────────────────────────────────────────────────

llm = ChatOllama(
    model=OLLAMA_MODEL,
    async_client=_ollama_client,
    base_url=OLLAMA_URL,
    temperature=0.3,
    num_predict=4096,
    num_ctx=8192,
)

# 시뮬레이션 전용 LLM — think 모드 비활성화 + 출력 토큰 제한
sim_llm = ChatOllama(
    model="qwen2.5:14b",
    base_url=OLLAMA_URL,
    temperature=0.3,
    num_predict=-1,
    num_ctx=16384,
)

# ── 멀티에이전트 워커 LLM (exaone3.5:2.4b × 4, 포트별 독립 인스턴스) ────────────────
WORKER_MODEL  = "exaone3.5:2.4b"
WORKER_PORTS  = [11435, 11436, 11437, 11438]
SPRING_BASE   = "http://localhost:8080"

worker_llms = [
    ChatOllama(
        model=WORKER_MODEL,
        base_url=f"http://localhost:{port}",
        temperature=0.1,   # 낮출수록 일관성↑, 할루시네이션↓
        num_predict=6000,  # think 토큰 충분히 확보 (느리지만 정확)
        num_ctx=8192,
    )
    for port in WORKER_PORTS
]

# 방위각 계산
def _calc_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    import math
    dlon = math.radians(lon2 - lon1)
    r1, r2 = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlon) * math.cos(r2)
    y = math.cos(r1) * math.sin(r2) - math.sin(r1) * math.cos(r2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360

def _bearing_dir(b: float) -> str:
    # 8방향 (45° 단위)
    if b < 22.5 or b >= 337.5: return 'N'
    if b < 67.5:  return 'NE'
    if b < 112.5: return 'E'
    if b < 157.5: return 'SE'
    if b < 202.5: return 'S'
    if b < 247.5: return 'SW'
    if b < 292.5: return 'W'
    return 'NW'

def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    import math
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

DIR_KO = {'N': '북', 'S': '남', 'E': '동', 'W': '서',
          'NE': '북동', 'NW': '북서', 'SE': '남동', 'SW': '남서'}

def calc_signal_delta(spd_f: float) -> tuple[str, int]:
    """속도 → (상태명, 권고 초 변화량) — 범위 아닌 중간 고정값으로 LLM 계산 제거"""
    if spd_f < 10:
        return "심한정체", +18   # 15~20 중간
    elif spd_f < 20:
        return "서행",   +10   # 8~12 중간
    elif spd_f < 30:
        return "약한정체", +4    # 3~5 중간
    else:
        return "원활",   -5

async def _classify_multi_analyze(question: str) -> tuple[bool, str | None]:
    """LLM으로 멀티에이전트 분석 의도 판단 + 장소명 추출
    Returns: (is_multi, location_name_or_None)
    응답 형식: "예:선릉역" / "예:없음" / "아니오"
    """
    r = await llm.ainvoke([{
        "role": "user",
        "content": (
            '/no_think 이 질문에 "주변/근처/인근 + 분석" 의도가 포함되어 있는지 판단해.\n'
            '"예:장소명" 또는 "예:없음" 또는 "아니오" 중 하나만 답해.\n'
            '장소명이 있으면 반드시 추출할 것. 뒤에 다른 작업(신호 최적화 등)이 붙어도 무시하고 근처 분석 의도만 판단.\n'
            '"선릉역 주변 분석해줘" → "예:선릉역"\n'
            '"개나리아파트 근처 분석해서 신호 최적화 해줘" → "예:개나리아파트"\n'
            '"강남역 인근 교차로 봐줘" → "예:강남역"\n'
            '"근처 교차로 분석해줘" → "예:없음"\n'
            '"주변 교차로 어때" → "예:없음"\n'
            '"잠실역 신호 어때" → "아니오"\n'
            '"병목 TOP3 알려줘" → "아니오"\n'
            '"이 교차로 분석해줘" → "아니오"\n'
            '"강남구 교통 상황은" → "아니오"\n'
            f'질문: {question}'
        )
    }])
    text = r.content.strip().split('\n')[0].strip()  # 첫 줄만 사용
    if text.startswith("예"):
        parts = text.split(":", 1)
        location = parts[1].strip() if len(parts) > 1 else ""
        location = None if not location or location == "없음" else location
        return True, location
    return False, None


def select_directional(center_lat, center_lon, crossroads):
    """방향별(N/S/E/W) 가장 가까운 교차로 최대 4개 선택, 중심 교차로 제외"""
    best: dict[str, tuple] = {}
    for cr in crossroads:
        b = _calc_bearing(center_lat, center_lon, cr['lat'], cr['lon'])
        d = _bearing_dir(b)
        dist = _haversine_km(center_lat, center_lon, cr['lat'], cr['lon'])
        if dist < 0.05:          # 50m 이내 = 중심 교차로 자신
            continue
        if d not in best or dist < best[d][1]:
            best[d] = (cr, dist)
    order = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    return [(cr, d) for d in order if d in best for (cr, _) in [best[d]]]

async def _worker_discuss_turn(worker_llm, worker_idx, dir_ko, my_nm, my_analysis,
                               analysis_results, discussion_so_far, queue):
    """순차 토론 한 턴: 지금까지 나온 토론을 보고 이어서 대화"""
    analyses = "\n".join(
        f"[{r['direction']}쪽 {r['crossroad_name']}] {r['content']}"
        for r in analysis_results
    )
    chat_so_far = "\n".join(
        f"[{d['direction']}쪽 {d['crossroad_name']}]: {d['content']}"
        for d in discussion_so_far
    ) if discussion_so_far else "아직 없음"

    prompt = (
        f"/no_think 반드시 한국어로 짧게 답변하십시오.\n\n"
        f"서울 교통 관제 AI 에이전트들이 실시간 대화 중이야.\n\n"
        f"[1차 분석 결과]\n{analyses}\n\n"
        f"[지금까지 대화]\n{chat_so_far}\n\n"
        f"이제 네 차례야. 너는 {dir_ko}쪽 {my_nm} 담당.\n"
        f"앞 에이전트들 말에 반응하거나 새로운 관점 추가. 2문장 이내로.\n"
        f"수치(초) 언급하면 좋아. 운전자 안내 말투 금지. 관제 에이전트끼리 대화하듯."
    )
    await queue.put({'type': 'discuss_start', 'worker_id': worker_idx,
                     'direction': dir_ko, 'crossroad_name': my_nm})
    try:
        result  = await worker_llm.ainvoke([{"role": "user", "content": prompt}])
        content = strip_chinese((result.content if hasattr(result, 'content') else str(result)).strip())
    except Exception as e:
        content = f'토론 오류: {e}'
    await queue.put({'type': 'discuss_done', 'worker_id': worker_idx,
                     'direction': dir_ko, 'crossroad_name': my_nm, 'content': content})
    return content


_WORKER_DIR_KO = {
    "nt": "북", "et": "동", "st": "남", "wt": "서",
    "ne": "북동", "nw": "북서", "se": "남동", "sw": "남서",
}
_WORKER_DIR_ORDER = ["nt", "et", "st", "wt", "ne", "nw", "se", "sw"]

def _build_dir_speed_str(speed_by_dir: dict | None) -> str:
    """방향별 속도를 '북 17.2km/h | 동 측정값없음 | 남 15.1km/h | ...' 형식으로 반환"""
    if not speed_by_dir:
        return "방향별 측정값 없음"
    parts = []
    seen = set()
    for code in _WORKER_DIR_ORDER:
        ko = _WORKER_DIR_KO[code]
        val = speed_by_dir.get(code)
        # "없음" 대신 "측정값없음" — LLM이 통행불가로 오해하지 않도록
        parts.append(f"{ko} {val}km/h" if val is not None else f"{ko} 측정값없음")
        seen.add(code)
    for code, val in speed_by_dir.items():
        if code not in seen:
            ko = _WORKER_DIR_KO.get(code, code)
            parts.append(f"{ko} {val}km/h" if val is not None else f"{ko} 측정값없음")
    return " | ".join(parts)

async def _worker_analyze(worker_llm, cr, traffic_data, worker_idx, direction, queue):
    """워커: 교차로 데이터 분석 후 결과를 queue에 push"""
    dir_ko   = DIR_KO.get(direction, direction)
    nm       = cr['crsrdNm']

    await queue.put({'type': 'worker_start', 'worker_id': worker_idx,
                     'direction': dir_ko, 'crossroad_name': nm,
                     'lat': cr.get('lat'), 'lon': cr.get('lon')})
    try:
        spd_raw = traffic_data.get('speedKph') if traffic_data else None
        has_valid_speed = isinstance(spd_raw, (int, float)) and spd_raw > 0

        if not traffic_data or not has_valid_speed:
            content   = f"{nm}: 실시간 속도 데이터 없음"
            spd       = 'N/A'
            state, delta, delta_str = "데이터없음", None, "데이터없음"
        else:
            spd        = spd_raw
            congestion = traffic_data.get('congestion', 'N/A')
            risk       = traffic_data.get('riskGrade', 'N/A')
            spd_by_dir = traffic_data.get('speedKphByDirection') or {}
            dir_speed_str = _build_dir_speed_str(spd_by_dir)

            # 중심 교차로를 향하는 방향 속도
            # 에이전트 위치의 반대 방향 = 중심으로 향하는 차량 속도
            _TOWARD_CENTER = {
                'E': 'wt', 'W': 'et', 'S': 'nt', 'N': 'st',
                'NE': 'sw', 'NW': 'se', 'SE': 'nw', 'SW': 'ne',
            }
            toward_key = _TOWARD_CENTER.get(direction)
            toward_spd = spd_by_dir.get(toward_key) if toward_key else None
            # 중심 방향 속도 있으면 그걸 사용, 없으면 평균으로 폴백
            calc_spd = float(toward_spd) if isinstance(toward_spd, (int, float)) and toward_spd > 0 else float(spd)

            state, delta = calc_signal_delta(calc_spd)
            sign      = "+" if delta >= 0 else ""
            delta_str = f"{sign}{delta}초"
            spd_display = f"{calc_spd}km/h" + (f" ({toward_key} 방향)" if toward_spd else " (평균)")
            pressure  = f"{state}({spd_display}) → 중심 교차로 {dir_ko}방향 유입 압력: {delta_str}"

            pressure_level = "높음" if delta > 5 else "낮음"
            prompt = (
                f"/think 반드시 한국어로만 답변하십시오.\n\n"
                f"[역할] 너는 데이터 보고 에이전트야. 신호 조정 결정은 오케스트레이터가 담당.\n"
                f"[담당 교차로] {nm} ({dir_ko}쪽)\n\n"
                f"[보유 데이터]\n"
                f"  평균 속도: {spd}km/h ({state})\n"
                f"  방향별 속도: {dir_speed_str}\n"
                f"  혼잡: {congestion} / 위험도: {risk}\n"
                f"  유입 압력 분석: {pressure}\n\n"
                f"아래 내용을 자연스러운 3문장으로 보고 (번호·레이블 출력 금지):\n"
                f"  · {dir_ko}쪽 {nm}의 방향별 속도를 그대로 나열\n"
                f"    (측정값없음 = 센서 미수신이며 통행 불가 아님, 통행불가/불가능 표현 금지)\n"
                f"  · 혼잡도와 위험도 등급\n"
                f"  · {dir_ko}방향 유입 압력 {pressure_level}, {delta_str}\n\n"
                f"금지: '1문장' '2문장' 레이블, 차량 대수, '+N초 해달라', '통행 불가능'"
            )
            result  = await worker_llm.ainvoke([{"role": "user", "content": prompt}])
            content = strip_chinese((result.content if hasattr(result, 'content') else str(result)).strip())

        has_data = has_valid_speed
        await queue.put({'type': 'worker_done', 'worker_id': worker_idx,
                         'direction': dir_ko, 'crossroad_name': nm,
                         'content': content, 'has_data': has_data,
                         'speed': spd, 'state': state,
                         'delta': delta, 'delta_str': delta_str,
                         'spd_by_dir': spd_by_dir if has_valid_speed else {}})
    except Exception as e:
        await queue.put({'type': 'worker_done', 'worker_id': worker_idx,
                         'direction': dir_ko, 'crossroad_name': nm,
                         'content': f'분석 오류: {e}', 'has_data': False,
                         'speed': 'N/A', 'state': '오류', 'delta': None, 'delta_str': '데이터없음'})

# 에이전트는 앱 시작 시 한 번만 생성 (MCP 클라이언트 포함)
agent = None
mcp_client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global agent, mcp_client

    mcp_client = MultiServerMCPClient({
        "traffic": {
            "command": PYTHON_BIN,
            "args": [MCP_SERVER_PATH],
            "transport": "stdio",
        }
    })

    tools = await mcp_client.get_tools()
    agent = create_react_agent(
        llm,
        tools,
        prompt=(
            "당신은 서울시 교통 관제 AI 어시스턴트입니다.\n"
            "반드시 한국어로만 답변하십시오. 중국어·영어 등 다른 언어는 절대 사용하지 마십시오.\n"
            "모든 분석 결과, 보고서, 권고사항은 한국어로 작성하십시오."
        ),
    )
    print(f"[에이전트] MCP 도구 {len(tools)}개 로드 완료", flush=True)

    yield


app = FastAPI(title="Traffic AI Agent", lifespan=lifespan)


async def agent_stream_with_cancel(request: Request, prompt: str):
    """에이전트 스트리밍 — 클라이언트 disconnect 시 aclose()로 Ollama 연결까지 완전 차단"""
    queue: asyncio.Queue = asyncio.Queue()

    async def _run():
        # generator를 변수에 담아 취소 시 aclose() 명시 호출 가능하게
        gen = agent.astream_events(
            {"messages": [{"role": "user", "content": prompt}]},
            version="v2",
            config={"recursion_limit": 10},
        )
        try:
            async for event in gen:
                await queue.put(("event", event))
        except asyncio.CancelledError:
            # aclose() 명시 호출 → httpx → Ollama 소켓 강제 종료
            await gen.aclose()
        except Exception as e:
            await queue.put(("error", e))
        finally:
            await queue.put(("done", None))

    task = asyncio.create_task(_run())
    try:
        while True:
            if await request.is_disconnected():
                print("[DISCONNECT] 클라이언트 연결 끊김 — 에이전트 취소", flush=True)
                task.cancel()
                # task가 완전히 끝날 때까지 대기 (aclose 포함)
                try:
                    await asyncio.wait_for(task, timeout=3.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
                print("[DISCONNECT] 에이전트 취소 완료", flush=True)
                return
            try:
                kind, value = await asyncio.wait_for(queue.get(), timeout=0.3)
            except asyncio.TimeoutError:
                continue
            if kind == "done":
                break
            yield kind, value
    finally:
        if not task.done():
            task.cancel()
            try:
                await asyncio.wait_for(task, timeout=3.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 요청/응답 모델 ───────────────────────────────────────────────────────────────

class NavIntentRequest(BaseModel):
    text: str

class ChatRequest(BaseModel):
    question: str
    crsrdId: str | None = None       # 선택된 교차로 ID (없으면 에이전트가 검색)
    crsrdNm: str | None = None       # 선택된 교차로 이름 (답변에 이름 사용)
    userEmail: str | None = None     # 요청한 유저 이메일 (메일 발송 시 사용)
    lat: float | None = None         # 선택된 교차로 위도 (멀티에이전트 라우팅용)
    lon: float | None = None         # 선택된 교차로 경도 (멀티에이전트 라우팅용)

class SimulationChatRequest(BaseModel):
    question: str
    context: dict | None = None         # 단일 신호계획 (기존 수동 챗봇용)
    contexts: list | None = None        # 다중 병목 교차로 신호계획 [{ intNo, intNm, phases, ... }]
    simulation: list | None = None      # 관제사 조정값 [{ no, sec, dirs }]
    routeTraffic: list | None = None    # 경로 구간별 실시간 속도 [{ fromIntNo, toIntNo, axisName, speedKph, congestion }]
    userEmail: str | None = None        # 요청한 유저 이메일 (메일 발송 시 사용)

class DistrictRequest(BaseModel):
    district: str
    userEmail: str | None = None  # 로그인한 유저 이메일 (없으면 발송 안 함)

class ChatResponse(BaseModel):
    answer: str
    adjustment: dict | None = None       # 단일 (하위 호환)
    adjustments: list | None = None      # 다중 병목 조정값
    report: str | None = None            # 이메일용 상세 분석 보고서

class ReportResponse(BaseModel):
    report: str
    district: str

class MultiAnalyzeRequest(BaseModel):
    lat: float
    lon: float
    crsrdId: str | None = None
    crsrdNm: str | None = None
    userEmail: str | None = None

# ── 헬퍼 ────────────────────────────────────────────────────────────────────────

def extract_adjustments(text: str):
    """AI 응답에서 JSON 파싱 → adjustments 리스트 반환
    지원 형식:
      ```json { "adjustments": [...] } ```  ← 백틱 형식
      {"adjustments": [...]} 텍스트         ← 백틱 없는 raw JSON
      { "intNo": "...", "phases": [...] }   ← 단일 (하위 호환)
    LLM이 마지막 } 를 빠뜨리는 경우 자동 수리 시도
    """
    import re as _re
    import json as _j

    def _parse(data):
        if isinstance(data, dict) and "adjustments" in data:
            items = data["adjustments"]
            valid = [a for a in items if isinstance(a, dict) and "intNo" in a and "phases" in a]
            return valid if valid else None
        if isinstance(data, dict) and "intNo" in data and "phases" in data:
            return [data]
        return None

    def _repair(s: str) -> str:
        """LLM이 생성하는 구조 오류 수리"""
        # 패턴 1: 마지막 phase 객체에서 } 빠뜨림
        # "sec": 33]}  →  "sec": 33}]
        s = _re.sub(r'("(?:sec|no)"\s*:\s*\d+)\s*\]', r'\1}]', s)
        # 패턴 2: key/value 순서 역전 (콤마 형식)
        # {"no": 3": "sec", 20}  →  {"no": 3, "sec": 20}
        s = _re.sub(r'"no"\s*:\s*(\d+)"\s*:\s*"sec"\s*,\s*(\d+)', r'"no": \1, "sec": \2', s)
        # 패턴 3: no 뒤 콜론 형식 (콤마 없이 바로 "sec":)
        # {"no": 3": "sec": 24}  →  {"no": 3, "sec": 24}
        s = _re.sub(r'"no"\s*:\s*(\d+)"\s*:\s*"sec"\s*:\s*(\d+)', r'"no": \1, "sec": \2', s)
        # 패턴 4: 숫자 뒤 불필요한 따옴표 (no 필드)
        # "no": 3", "sec"  →  "no": 3, "sec"
        s = _re.sub(r'("no"\s*:\s*)(\d+)"(\s*,\s*"sec")', r'\1\2\3', s)
        # 패턴 5: 숫자 뒤 불필요한 따옴표 (sec 필드)
        # "sec": 24", "no"  →  "sec": 24, "no"
        s = _re.sub(r'("sec"\s*:\s*)(\d+)"(\s*[,}])', r'\1\2\3', s)
        return s

    def _try_load(s: str):
        """파싱 시도 → 실패하면 수리 후 재시도, 그 다음 suffix 보정"""
        try:
            return _j.loads(s)
        except Exception:
            pass
        # 중간 구조 수리 후 재시도
        repaired = _repair(s)
        if repaired != s:
            try:
                return _j.loads(repaired)
            except Exception:
                pass
        for src in (s, repaired):
            for suffix in ("}", "]}", "}]}", "}]}"):
                try:
                    return _j.loads(src + suffix)
                except Exception:
                    pass
        return None

    # 1. ```json...``` 형식
    match = _re.search(r"```json\s*(.*?)\s*(?:```|$)", text, _re.DOTALL)
    if match:
        data = _try_load(match.group(1).strip())
        if data is not None:
            result = _parse(data)
            if result:
                return result

    # 2. 백틱 없이 { 로 시작하는 raw JSON
    start = text.find('{"adjustments"')
    if start == -1:
        start = text.find('{"intNo"')
    if start != -1:
        fragment = text[start:]
        # 닫는 ``` 이전까지만 자르기
        end = fragment.find("```")
        if end != -1:
            fragment = fragment[:end].strip()
        try:
            decoder = _j.JSONDecoder()
            data, _ = decoder.raw_decode(fragment)
            result = _parse(data)
            if result:
                return result
        except Exception:
            pass
        data = _try_load(fragment)
        if data is not None:
            return _parse(data)

    return None


# ── Webster B안 상수 ─────────────────────────────────────────────────────────────
_WB_CYCLE_BAND = 0.15   # cycleVal ±15%
_WB_DELTA_MAX  = 5      # 현시별 최대 변화량(초)
_WB_MIN_GREEN  = 15     # 최소 녹색시간(초)


def _wb_speed_to_Y(u: float | None) -> tuple[float, str]:
    """
    진입 링크 속도(km/h) → (ΣY 추정값, 혼잡등급 설명)
    속도를 교차로 전체 포화도 지표로 사용.
      u < 15  → 심각 → ΣY=0.85
      15~25   → 혼잡 → ΣY=0.75
      25~30   → 서행 → ΣY=0.65
      > 30    → 원활 → ΣY=0.50
    """
    if u is None:
        return 0.65, "미측정→서행 기본값"
    if u < 15:
        return 0.85, f"심각({u:.1f}km/h)"
    if u < 25:
        return 0.75, f"혼잡({u:.1f}km/h)"
    if u <= 30:
        return 0.65, f"서행({u:.1f}km/h)"
    return 0.50, f"원활({u:.1f}km/h)"


def _wb_is_pedestrian(dirs: list) -> bool:
    return any("보행" in d for d in dirs)


def compute_webster_adjustments(
    contexts: list, route_traffic: list
) -> tuple[list, list]:
    """
    신호계획 + 진입속도(1개) → Webster B안 계산.
    입력: u(구간 평균속도) + cycleVal + 현시시간들
    반환: (adjustments, calc_details)
    """
    # toIntNo 기준 평균 속도 맵
    speed_map: dict[str, list] = {}
    for seg in (route_traffic or []):
        key = str(seg.get("toIntNo", ""))
        spd = seg.get("speedKph")
        if key and spd is not None:
            speed_map.setdefault(key, []).append(float(spd))
    avg_speed_map = {k: sum(v) / len(v) for k, v in speed_map.items()}

    adjustments: list = []
    calc_details: list = []

    for ctx in (contexts or []):
        int_no    = str(ctx.get("intNo", ""))
        int_nm    = ctx.get("intNm") or int_no
        phases    = ctx.get("phases", [])
        cycle_val = int(ctx.get("cycleVal") or 140)
        if not phases or not int_no:
            continue

        u = avg_speed_map.get(int_no)
        sum_Y, cong_grade = _wb_speed_to_Y(u)

        phase_count = len(phases)
        L = phase_count * 4  # 손실시간: 현시 수 × 4s

        # ── Webster 최적 주기 → cycleVal ±15% 클램핑 ─────────────────────────
        Co_raw   = (1.5 * L + 5) / max(1.0 - sum_Y, 0.01)
        Co_final = int(round(max(
            cycle_val * (1 - _WB_CYCLE_BAND),
            min(cycle_val * (1 + _WB_CYCLE_BAND), Co_raw)
        )))
        # 심각 등급은 주기 하향 금지 — 막힌 교차로 처리 용량 보호
        held_cycle = cong_grade.startswith("심각") and Co_final < cycle_val
        if held_cycle:
            Co_final = cycle_val

        # ── 현시 배분: 보행 고정, 나머지 기존 비율로 재스케일 ────────────────
        ped_fixed_sum    = sum(int(p.get("sec") or 0) for p in phases if _wb_is_pedestrian(p.get("dirs") or []))
        non_ped_orig_sum = sum(int(p.get("sec") or 0) for p in phases if not _wb_is_pedestrian(p.get("dirs") or []))
        budget           = Co_final - ped_fixed_sum  # 비보행 현시에 분배할 시간

        phase_rows = []
        assigned   = 0
        for p in phases:
            orig_sec = int(p.get("sec") or 0)
            dirs     = p.get("dirs") or []
            is_ped   = _wb_is_pedestrian(dirs)

            if is_ped:
                new_sec = orig_sec
                delta   = 0
            elif non_ped_orig_sum > 0:
                target_g = budget * orig_sec / non_ped_orig_sum
                delta    = max(-_WB_DELTA_MAX,
                               min(_WB_DELTA_MAX, round(target_g - orig_sec)))
                new_sec  = max(_WB_MIN_GREEN, orig_sec + delta)
            else:
                new_sec = orig_sec
                delta   = 0

            phase_rows.append({
                "no":       int(p["no"]),
                "dirs":     "/".join(dirs) if dirs else "미확인",
                "orig_sec": orig_sec,
                "is_ped":   is_ped,
                "new_sec":  new_sec,
                "delta":    delta,
            })
            assigned += new_sec

        adjustments.append({
            "intNo": int_no,
            "phases": [{"no": r["no"], "sec": r["new_sec"]} for r in phase_rows],
        })
        applied_cycle = sum(r["new_sec"] for r in phase_rows)
        calc_details.append({
            "int_no":        int_no,
            "int_nm":        int_nm,
            "u":             round(u, 1) if u is not None else None,
            "cong_grade":    cong_grade,
            "sum_Y":         sum_Y,
            "L":             L,
            "phase_count":   phase_count,
            "Co_raw":        round(Co_raw, 1),
            "Co_final":      Co_final,
            "held_cycle":    held_cycle,
            "applied_cycle": applied_cycle,
            "cycle_val":     cycle_val,
            "phases":        phase_rows,
        })

    return adjustments, calc_details


def _build_calc_block(calc_details: list) -> str:
    """calc_details → LLM 프롬프트 주입용 텍스트 블록"""
    lines = ["\n\n[Webster 계산 결과 — 아래 숫자를 그대로 사용해 설명할 것. 임의 재계산 금지]"]
    for d in calc_details:
        u_str = f"{d['u']}km/h" if d["u"] is not None else "미측정"
        lines.append(f"\n교차로: {d['int_nm']} (intNo:{d['int_no']})")
        lines.append(f"진입속도: {u_str} → 혼잡등급: {d['cong_grade']} → ΣY={d['sum_Y']}")
        lines.append(f"L={d['L']}s ({d['phase_count']}현시×4s)")
        lines.append(
            f"Co=(1.5×{d['L']}+5)/(1-{d['sum_Y']})={d['Co_raw']}s"
            f" → clamp(cycleVal={d['cycle_val']}s ±15%) → 최종주기: {d['Co_final']}s"
        )
        for row in d["phases"]:
            ped_mark  = " [보행고정]" if row["is_ped"] else ""
            delta_str = f"Δ{row['delta']:+d}s" if row["delta"] != 0 else "Δ0s(변경없음)"
            lines.append(
                f"  현시{row['no']} ({row['dirs']}){ped_mark}: "
                f"{row['orig_sec']}s → {row['new_sec']}s ({delta_str})"
            )
        ac = d["applied_cycle"]
        cf = d["Co_final"]
        if d.get("held_cycle"):
            lines.append(f"1회 적용주기: {ac}s [심각 등급 — 주기 하향 금지, 현행 유지]")
        else:
            gap_note = f" (목표 {cf}s까지 {cf - ac}s 미달 — 점진조정 특성)" if ac != cf else ""
            lines.append(f"1회 적용주기: {ac}s{gap_note}")
    lines.append("\n※ 방향별 교통량 미계측으로 현시 배분은 기존 운영 비율 유지, 주기만 조정.")
    lines.append("※ 속도 기반 혼잡등급으로 포화도(ΣY) 추정. ±5s 점진조정, 반복 적용 시 수렴.")
    lines.append("※ 경로 내 교차로별 독립 최적화 방식. 간선 연동(공통 주기)은 향후 과제.")
    return "\n".join(lines)


def _build_email_report(calc_details: list) -> str:
    """교차로별 Webster 수식 포함 이메일 상세 보고서 — LLM 미사용, Python 직접 생성"""
    from datetime import datetime
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"[Webster 신호 최적화 리포트]  분석일시: {now}",
        "=" * 52,
    ]
    for d in calc_details:
        u_str = f"{d['u']}km/h" if d["u"] is not None else "미측정"
        lines.append(f"\n■ 교차로: {d['int_nm']}  (intNo:{d['int_no']})")
        lines.append("-" * 48)
        lines.append(f"진입속도:  {u_str}")
        lines.append(f"혼잡등급:  {d['cong_grade']}  →  ΣY = {d['sum_Y']}")
        lines.append("")
        lines.append("◎ Webster 최적 주기 계산")
        lines.append(f"  L  = {d['phase_count']}현시 × 4s = {d['L']}s")
        lines.append(f"  Co = (1.5×{d['L']} + 5) / (1 - {d['sum_Y']})")
        lines.append(f"     = {1.5*d['L']+5:.1f} / {1-d['sum_Y']:.2f} = {d['Co_raw']}s")
        cv = d["cycle_val"]
        lines.append(f"  현행주기 = {cv}s,  조정범위 = {cv*0.85:.0f}~{cv*1.15:.0f}s")
        if d.get("held_cycle"):
            lines.append(f"  ※ 심각 등급 → 주기 하향 금지: Co_final = max({d['Co_raw']}s, {cv}s) = {d['Co_final']}s")
        else:
            lines.append(f"  clamp 적용 → Co_final = {d['Co_final']}s")
        lines.append("")
        lines.append("◎ 현시별 조정")
        no_margin = all(r["delta"] == 0 for r in d["phases"] if not r["is_ped"])
        for row in d["phases"]:
            ped_mark  = " [보행고정]" if row["is_ped"] else ""
            delta_str = f"Δ{row['delta']:+d}s" if row["delta"] != 0 else "Δ0s"
            lines.append(f"  현시{row['no']} ({row['dirs']}){ped_mark}: {row['orig_sec']}s → {row['new_sec']}s  ({delta_str})")
        if no_margin and d.get("held_cycle"):
            lines.append("  → 보행시간 보장 제약으로 조정 여지 없음, 현행 유지")
        ac, cf = d["applied_cycle"], d["Co_final"]
        gap = cf - ac
        if gap:
            lines.append(f"\n  1회 적용주기: {ac}s  (목표 {cf}s, {gap}s 미달 — 점진조정 특성)")
        else:
            lines.append(f"\n  1회 적용주기: {ac}s")
    lines += [
        "",
        "=" * 52,
        "【한계 및 유의사항】",
        "• 방향별 교통량 미계측 → 현시 배분은 기존 운영 비율 유지, 주기만 조정.",
        "• 속도 기반 혼잡등급으로 포화도(ΣY) 추정 (실측 교통량과 차이 가능).",
        "• cycleVal ±15% 점진 조정 방식 적용 (급격한 주기 변경 방지).",
        "• 경로 내 교차로별 독립 최적화 방식. 간선 연동(공통 주기)은 향후 과제.",
        "• 근거 없는 효과 추정(지체 감소율 등)은 포함하지 않음.",
    ]
    return "\n".join(lines)


_CJK_RE = re.compile(
    "[\u4e00-\u9fff"   # CJK Unified Ideographs
    "[\u3400-\u4dbf"   # CJK Extension A
    "[\uf900-\ufaff"   # CJK Compatibility Ideographs
    "[\u2e80-\u2eff"   # CJK Radicals Supplement
    "[\u2f00-\u2fdf]"  # Kangxi Radicals
)

def strip_chinese(text: str) -> str:
    """CJK 한자가 포함된 줄 제거 + 빈 줄 압축.
    qwen3 모델이 한국어 지시에도 간헐적으로 중국어를 생성하는 것을 방어.
    한글·숫자·영문·기호는 보존.
    """
    lines = text.splitlines()
    cleaned = [ln for ln in lines if not _CJK_RE.search(ln)]
    result, prev_blank = [], False
    for ln in cleaned:
        blank = ln.strip() == ""
        if blank and prev_blank:
            continue
        result.append(ln)
        prev_blank = blank
    return "\n".join(result).strip()


def strip_json_block(text: str) -> str:
    """AI 응답에서 JSON 블록 제거 — 사용자 표시용 텍스트 정리"""
    import re as _re
    import json as _j
    # ```json...``` 제거
    cleaned = _re.sub(r"```json.*?```", "", text, flags=_re.DOTALL).strip()
    # 앞에 붙은 raw JSON 제거
    if cleaned.startswith('{"adjustments"') or cleaned.startswith('{"intNo"'):
        try:
            decoder = _j.JSONDecoder()
            _, end_idx = decoder.raw_decode(cleaned)
            cleaned = cleaned[end_idx:].strip()
        except Exception:
            pass
    return cleaned


def extract_answer(result: dict) -> str:
    """LangGraph ReAct 결과에서 최종 텍스트 추출"""
    messages = result.get("messages", [])
    for msg in reversed(messages):
        if not isinstance(msg, AIMessage):
            continue
        raw = msg.content
        if isinstance(raw, list):
            content = " ".join(
                item.get("text", "") if isinstance(item, dict) else str(item)
                for item in raw
            ).strip()
        else:
            content = raw or ""
        if not content:
            continue
        # <think> 태그 제거 — 태그 밖에 내용이 없으면 태그 안 내용 사용
        if "<think>" in content:
            after = content.split("</think>")[-1].strip()
            if after:
                return after
            # </think> 뒤가 비어있으면 think 블록 내용 자체를 반환
            inside = content.split("<think>", 1)[-1].split("</think>")[0].strip()
            if inside:
                return inside
            continue
        return content
    return "응답을 생성할 수 없습니다."

# ── 엔드포인트 ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "model": OLLAMA_MODEL, "mcp": "connected"}


@app.post("/api/nav/intent")
async def nav_intent(req: NavIntentRequest):
    """음성 명령 의도 분류 — 데이터 조회 없이 텍스트만 파싱해서 JSON 반환"""
    import json as _json

    SEOUL_GU = [
        "종로구","중구","용산구","성동구","광진구","동대문구","중랑구","성북구",
        "강북구","도봉구","노원구","은평구","서대문구","마포구","양천구","강서구",
        "구로구","금천구","영등포구","동작구","관악구","서초구","강남구","송파구","강동구",
    ]

    prompt = f"""너는 교통 관제 시스템의 음성 명령 분류기야.
아래 사용자 명령을 분석해서 반드시 JSON 한 줄만 출력해. 다른 말은 절대 하지 마.

분류 규칙:
1. 페이지 이동 명령 → {{"action":"navigate","page":"map|simulation|cctv|news"}}
   - 지도/맵/실시간 지도 → map
   - 시뮬레이션/신호/신호등 → simulation
   - CCTV/씨씨티비/카메라 → cctv
   - 뉴스/감성 → news
2. 구 선택/이동 명령 → {{"action":"select_gu","gu":"구이름"}}
   - 반드시 "~로 가줘", "~으로 이동", "~구 선택", "~구 보여줘" 같은 명시적 이동/선택 표현이 있어야 함
   - 단순히 구 이름만 언급하거나 질문("~구 날씨 어때", "~구 교통 어때")이면 unknown
   - 해당 구: {', '.join(SEOUL_GU)}
3. 마이페이지 → {{"action":"mypage"}}
   - 마이페이지/내 정보/프로필/설정
4. 로그아웃 → {{"action":"logout"}}
   - 로그아웃/나가기/종료
5. 위 어디에도 해당 없으면 → {{"action":"unknown"}}

명령: {req.text}
JSON:"""

    try:
        response = await llm.ainvoke(prompt)
        raw = response.content if hasattr(response, "content") else str(response)
        # <think> 블록 제거
        if "<think>" in raw:
            raw = raw.split("</think>")[-1].strip()
        # JSON 추출 (중괄호만)
        start, end = raw.find("{"), raw.rfind("}") + 1
        if start == -1 or end == 0:
            return {"action": "unknown"}
        return _json.loads(raw[start:end])
    except Exception:
        return {"action": "unknown"}


@app.post("/api/agent/stop")
async def stop_agent():
    """진행 중인 Ollama 요청 즉시 차단 — httpx 소켓 강제 종료 후 재생성"""
    global _ollama_client
    try:
        await _ollama_client._client.aclose()
        print("[STOP] Ollama 연결 강제 종료", flush=True)
    except Exception as e:
        print(f"[STOP] 오류: {e}", flush=True)
    # 다음 요청을 위해 새 httpx 클라이언트로 교체
    _ollama_client._client = httpx.AsyncClient(
        base_url=OLLAMA_URL,
        timeout=httpx.Timeout(None),
    )
    return {"status": "stopped"}


@app.post("/api/agent/chat", response_model=ChatResponse)
async def free_chat(req: ChatRequest):
    """지도 페이지 자유 챗봇 — 에이전트가 교차로 검색 후 분석"""

    analysis_rule = (
        "\n\n[분석 작성 규칙 — 반드시 준수]\n"
        "데이터를 단순 나열하지 말고 교차로별로 아래 형식으로 작성:\n"
        "① 현재 상태: 속도·위험등급·혼잡도 요약\n"
        "② 혼잡 원인: 어느 방향 신호가 왜 막히는지 (rmndCs 높은 적색 방향 기준)\n"
        "③ 조정 권고: 구체적으로 어떤 현시를 몇 초 조정할지\n"
        "답변은 분석 내용으로 끝낼 것.\n"
        "'추가 분석', '이메일로 보낼 필요', '알려주세요', '도움이 필요하시면', '다른 요청이 있으시면' 등 "
        "서비스 안내·권유·마무리 문구를 답변 마지막에 절대 붙이지 말 것."
    )

    email_ctx = (
        f"\n[요청 유저 이메일: {req.userEmail}]"
        f"\n[이메일 발송 엄격 규칙] 사용자 질문에 '이메일', '메일', '메일로', '이메일로' 단어가 직접 포함된 경우에만 send_email_report 호출 가능.\n"
        "분석·최적화·리포트 요청이라도 이메일 키워드 없으면 send_email_report 절대 호출 금지.\n"
        "send_email_report 호출 시 subject는 '[Syncro] 분석결과를 알려드립니다' 형식으로 작성할 것.\n"
        "이메일 본문 마지막에는 반드시 아래 마무리 문구를 그대로 추가할 것:\n"
        "---\n본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\n감사합니다.\n\nSyncro 교통 관제 시스템 드림\n"
        "이메일 발송 여부를 묻거나 '이메일로 보내드릴까요?' 같은 문구를 답변에 절대 포함하지 말 것."
    ) if req.userEmail else ""

    cr_ctx = (
        f"현재 선택된 교차로는 '{req.crsrdNm}' (ID: {req.crsrdId})야.\n"
        if req.crsrdId and req.crsrdNm else
        f"현재 선택된 교차로 ID는 {req.crsrdId}야.\n"
        if req.crsrdId else ""
    )

    if req.crsrdId:
        prompt = (
            f"/no_think\n"
            f"서울 교통 관제 시스템이야. 반드시 한국어로 답해줘.\n"
            f"{cr_ctx}"
            f"답변에서 교차로를 지칭할 때 반드시 교차로 이름을 사용하고 숫자 ID는 절대 노출하지 말 것.\n"
            f"질문에 현재 선택된 교차로와 다른 교차로명·장소명(학교, 건물, 역 등)이 언급되면 "
            f"get_traffic_data 대신 반드시 search_crossroad_by_name으로 먼저 검색할 것.\n"
            f"질문이 현재 선택된 교차로에 관한 것이면 get_traffic_data({req.crsrdId})를 사용할 것.\n"
            f"질문이 병목·TOP에 관한 거면 get_bottleneck_list를 먼저 호출해서 병목 순위를 구하고 "
            f"각 교차로를 get_traffic_data로 조회해서 분석해줘. 선택된 교차로는 무시해도 됨.\n"
            f"질문: {req.question}"
            f"{analysis_rule}"
            f"{email_ctx}"
        )
    else:
        prompt = (
            f"/no_think\n"
            f"서울 교통 관제 시스템이야. 반드시 한국어로 답해줘.\n"
            f"질문에 자치구 이름(예: 강남구, 서초구 등)이 있으면 반드시 get_district_traffic 도구를 호출해서 "
            f"속도·위험도·날씨 데이터를 가져올 것. 날씨·교통·혼잡 관련 질문도 모두 이 도구로 처리할 것. "
            f"추가 위치 질문 없이 즉시 도구를 호출할 것.\n"
            f"질문: {req.question}"
            f"{analysis_rule}"
            f"{email_ctx}"
        )

    result = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]})
    return ChatResponse(answer=extract_answer(result))


TOOL_LABELS = {
    "get_traffic_data":           "교차로 실시간 데이터 조회",
    "get_bottleneck_list":        "전체 병목 목록 조회",
    "search_crossroad_by_name":   "교차로 이름 검색",
    "get_district_traffic":       "자치구 교통 현황 조회",
    "set_signal_timing":          "신호 타이밍 조정",
    "send_alert":                 "관제사 알림 전송",
    "send_email_report":          "이메일 리포트 전송",
    "get_simulation_context":     "신호계획 조회",
    "search_project_docs":        "도메인 지식 검색",
    "classify_intent":            "의도 분류",
    "search_crossroad_location":  "교차로 좌표 검색",
}


@app.post("/api/agent/chat/stream")
async def free_chat_stream(req: ChatRequest, request: Request):
    """ReAct 루프 단계별 SSE 스트리밍 — 프론트 팝업 시각화용"""
    import json as _json

    analysis_rule = (
        "\n\n[분석 작성 규칙 — 반드시 준수]\n"
        "데이터를 단순 나열하지 말고 반드시 아래 형식으로 작성:\n"
        "① 현재 상태: 속도·위험등급·혼잡도 요약\n"
        "② 혼잡 원인: 어느 방향 신호가 왜 막히는지 (rmndCs 높은 적색 방향 기준)\n"
        "③ 조정 권고: 구체적으로 어떤 현시를 몇 초 조정할지\n"
        "이메일 본문도 동일한 분석 형식으로 작성할 것. 데이터 나열 금지.\n"
        "이메일 본문 마지막에는 반드시 '---\\n본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\\n감사합니다.\\n\\nSyncro 교통 관제 시스템 드림' 문구를 추가할 것."
    )

    email_ctx = (
        f"\n[요청 유저 이메일: {req.userEmail}]"
        f"\n[이메일 발송 엄격 규칙] 사용자 질문에 '이메일', '메일', '메일로', '이메일로' 단어가 직접 포함된 경우에만 send_email_report 호출 가능.\n"
        "분석·최적화·리포트 요청이라도 이메일 키워드 없으면 send_email_report 절대 호출 금지.\n"
        "send_email_report 호출 시 subject는 '[Syncro] 분석결과를 알려드립니다' 형식으로 작성할 것.\n"
        "이메일 본문 마지막에는 반드시 아래 마무리 문구를 그대로 추가할 것:\n"
        "---\n본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\n감사합니다.\n\nSyncro 교통 관제 시스템 드림\n"
        "이메일 발송 여부를 묻거나 '이메일로 보내드릴까요?' 같은 문구를 답변에 절대 포함하지 말 것."
    ) if req.userEmail else ""

    cr_ctx = (
        f"현재 선택된 교차로는 '{req.crsrdNm}' (ID: {req.crsrdId})야.\n"
        if req.crsrdId and req.crsrdNm else
        f"현재 선택된 교차로 ID는 {req.crsrdId}야.\n"
        if req.crsrdId else ""
    )

    if req.crsrdId:
        prompt = (
            f"/no_think\n"
            f"서울 교통 관제 시스템이야. 반드시 한국어로 답해줘.\n"
            f"{cr_ctx}"
            f"답변에서 교차로를 지칭할 때 반드시 교차로 이름을 사용하고 숫자 ID는 절대 노출하지 말 것.\n"
            f"질문에 현재 선택된 교차로와 다른 교차로명·장소명(학교, 건물, 역 등)이 언급되면 "
            f"get_traffic_data 대신 반드시 search_crossroad_by_name으로 먼저 검색할 것.\n"
            f"질문이 현재 선택된 교차로에 관한 것이면 get_traffic_data({req.crsrdId})를 사용할 것.\n"
            f"질문이 병목·TOP에 관한 거면 get_bottleneck_list를 먼저 호출해서 병목 순위를 구하고 "
            f"각 교차로를 get_traffic_data로 조회해서 분석해줘. 선택된 교차로는 무시해도 됨.\n"
            f"질문: {req.question}"
            f"{analysis_rule}{email_ctx}"
        )
    else:
        prompt = (
            f"/no_think\n"
            f"서울 교통 관제 시스템이야. 반드시 한국어로 답해줘.\n"
            f"질문에 자치구 이름(예: 강남구, 서초구 등)이 있으면 반드시 get_district_traffic 도구를 호출해서 "
            f"속도·위험도·날씨 데이터를 가져올 것. 날씨·교통·혼잡 관련 질문도 모두 이 도구로 처리할 것. "
            f"추가 위치 질문 없이 즉시 도구를 호출할 것.\n"
            f"질문: {req.question}"
            f"{analysis_rule}{email_ctx}"
        )

    async def generate():
        # 주변/근처/인근 키워드 또는 좌표가 있을 때만 LLM 분류 실행 (불필요한 분류 오버헤드 방지)
        has_nearby_kw = any(kw in req.question for kw in ['주변', '근처', '인근'])
        if has_nearby_kw or (req.lat is not None and req.lon is not None):
            try:
                is_multi, location = await _classify_multi_analyze(req.question)
                if is_multi:
                    lat, lon = req.lat, req.lon
                    crsrd_id, crsrd_nm = req.crsrdId, req.crsrdNm

                    # Step 1: 의도 분류 완료 알림
                    loc_label = location or "(현재 위치)"
                    yield f"data: {_json.dumps({'type': 'action', 'tool': 'classify_intent', 'label': '의도 분류', 'args': req.question[:60]}, ensure_ascii=False)}\n\n"
                    yield f"data: {_json.dumps({'type': 'observation', 'content': f'주변 분석 의도 확인 · 장소명: {loc_label}'}, ensure_ascii=False)}\n\n"

                    # 좌표 없으면 장소명으로 신호 캐시에서 교차로 검색
                    if lat is None and location:
                        yield f"data: {_json.dumps({'type': 'action', 'tool': 'search_crossroad_location', 'label': '교차로 좌표 검색', 'args': location}, ensure_ascii=False)}\n\n"
                        async with httpx.AsyncClient(timeout=5.0) as cl:
                            sig_r = await cl.get(f"{SPRING_BASE}/api/signals")
                            signals = sig_r.json() if sig_r.status_code == 200 else []
                        matched = [
                            s for s in (signals if isinstance(signals, list) else [])
                            if location in s.get("crsrdNm", "")
                        ]
                        if matched:
                            first = matched[0]
                            lat      = first.get("lat")
                            lon      = first.get("lon")
                            crsrd_id = str(first.get("crsrdId", ""))
                            crsrd_nm = first.get("crsrdNm", location)
                            yield f"data: {_json.dumps({'type': 'observation', 'content': f'{crsrd_nm} 발견 ({lat:.4f}, {lon:.4f})'}, ensure_ascii=False)}\n\n"
                        else:
                            yield f"data: {_json.dumps({'type': 'observation', 'content': f'{location} 교차로 없음 — 현재 위치 사용'}, ensure_ascii=False)}\n\n"

                    if lat is not None:
                        yield f"data: {_json.dumps({'type': 'route_multi', 'lat': lat, 'lon': lon, 'crsrdId': crsrd_id, 'crsrdNm': crsrd_nm}, ensure_ascii=False)}\n\n"
                        return
            except Exception:
                pass  # 분류/검색 실패 시 일반 ReAct로 폴백

        try:
            async for msg_kind, event in agent_stream_with_cancel(request, prompt):
                if msg_kind == "error":
                    yield f"data: {_json.dumps({'type': 'error', 'content': str(event)}, ensure_ascii=False)}\n\n"
                    return
                kind = event["event"]
                name = event.get("name", "")

                # ── 도구 호출 시작 ──────────────────────────────────────────
                if kind == "on_tool_start":
                    args = event["data"].get("input", {})
                    args_str = ", ".join(f"{k}={v}" for k, v in args.items()) if args else ""
                    data = {
                        "type": "action",
                        "tool": name,
                        "label": TOOL_LABELS.get(name, name),
                        "args": args_str,
                    }
                    yield f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"

                # ── 도구 결과 수신 ──────────────────────────────────────────
                elif kind == "on_tool_end":
                    output = event["data"].get("output")
                    obs = ""
                    if output is not None:
                        raw = str(output.content) if hasattr(output, "content") else str(output)
                        try:
                            parsed = _json.loads(raw)
                            if isinstance(parsed, dict):
                                keys = list(parsed.keys())[:4]
                                obs = "{ " + ", ".join(keys) + (" ..." if len(parsed) > 4 else "") + " }"
                            elif isinstance(parsed, list):
                                obs = f"[{len(parsed)}개 항목 반환]"
                            else:
                                obs = raw[:150]
                        except Exception:
                            obs = raw[:150]
                    yield f"data: {_json.dumps({'type': 'observation', 'content': obs}, ensure_ascii=False)}\n\n"

                # ── LLM 응답 완료 ───────────────────────────────────────────
                elif kind == "on_chat_model_end":
                    output = event["data"].get("output")
                    if not output:
                        continue
                    has_tool_calls = bool(getattr(output, "tool_calls", None))
                    content = output.content if hasattr(output, "content") else ""
                    if isinstance(content, list):
                        content = " ".join(
                            item.get("text", "") if isinstance(item, dict) else str(item)
                            for item in content
                        ).strip()

                    # <think> 블록 → Thought 이벤트로 전송
                    if content and "<think>" in content:
                        inside = content.split("<think>", 1)[-1].split("</think>")[0].strip()
                        if inside:
                            yield f"data: {_json.dumps({'type': 'thought', 'content': inside[:200]}, ensure_ascii=False)}\n\n"

                    # 도구 호출 없는 마지막 응답 = 최종 답변
                    if not has_tool_calls and content:
                        if "<think>" in content:
                            after = content.split("</think>")[-1].strip()
                            content = after if after else content
                        if content:
                            yield f"data: {_json.dumps({'type': 'answer', 'content': content}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {_json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/agent/simulation-chat", response_model=ChatResponse)
async def simulation_chat(req: SimulationChatRequest):
    """시뮬레이션 페이지 챗봇 — Spring이 조립한 컨텍스트를 프롬프트에 직접 삽입"""
    import json

    # 단일 context (수동 챗봇)
    ctx_block = ""
    if req.context and not req.contexts:
        c = req.context
        phases = c.get("phases", [])
        phase_str = ", ".join(
            f"현시{p.get('no')}:{p.get('sec')}s({'/'.join(p.get('dirs', []))})"
            for p in phases
        )
        ctx_block = f"\n\n[신호계획 - {c.get('intNm') or c.get('intNo')} (intNo:{c.get('intNo')})] cycleVal={c.get('cycleVal')}s | {phase_str}"

    # 다중 contexts (병목 자동 분석) — 토큰 절약을 위해 요약 형식
    if req.contexts:
        parts = []
        for c in req.contexts:
            name = c.get("intNm") or c.get("intNo") or "?"
            phases = c.get("phases", [])
            phase_str = ", ".join(
                f"현시{p.get('no')}:{p.get('sec')}s({'/'.join(p.get('dirs', []))})"
                for p in phases
            )
            parts.append(f"[신호계획 - {name} (intNo:{c.get('intNo')})] cycleVal={c.get('cycleVal')}s | {phase_str}")
        ctx_block = "\n\n" + "\n".join(parts)

    sim_block = ""
    if req.simulation:
        sim_block = (
            f"\n\n[관제사 조정값]\n"
            f"{json.dumps(req.simulation, ensure_ascii=False, indent=2)}\n"
            f"원래 신호계획과 비교해서 어떤 현시가 얼마나 바뀌었는지 분석해줘."
        )

    _DIR_KO = {"north":"북","east":"동","south":"남","west":"서",
               "northeast":"북동","northwest":"북서","southeast":"남동","southwest":"남서"}

    traffic_block = ""
    if req.routeTraffic:
        lines = []
        for seg in req.routeTraffic:
            spd = seg.get("speedKph")
            cng = seg.get("congestion", "")
            spd_str = f"{spd}km/h" if spd is not None else "미수집"
            bottleneck_mark = " ★병목" if spd is not None and spd < 15 else ""
            spd_by_dir = seg.get("speedByDirection") or {}
            dir_parts = [f"{_DIR_KO.get(k, k)} {v}km/h" for k, v in spd_by_dir.items() if v is not None]
            dir_str = f" [{', '.join(dir_parts)}]" if dir_parts else ""
            lines.append(
                f"  {seg.get('fromIntNo','?')}→{seg.get('toIntNo','?')}"
                f" ({seg.get('axisName','')}) | 평균 {spd_str}{dir_str} | {cng}{bottleneck_mark}"
            )
        traffic_block = (
            "\n\n[경로 구간별 실시간 속도 — 15km/h 이하가 병목]\n" + "\n".join(lines)
        )

    # ── Python 먼저 계산 (adjustments 확정) ─────────────────────────────────────
    contexts_list = req.contexts if req.contexts else ([req.context] if req.context else [])
    adjustments, calc_details = compute_webster_adjustments(contexts_list, req.routeTraffic or [])
    print(f"[SIM-CHAT] Python Webster 계산 완료 — {len(adjustments)}개 교차로", flush=True)

    calc_block = _build_calc_block(calc_details) if calc_details else ""

    # ── 이메일 보고서: LLM 없이 Python 직접 생성 ────────────────────────────────
    email_report = _build_email_report(calc_details) if calc_details else None

    # ── LLM: 화면용 간단 설명만 생성 ─────────────────────────────────────────────
    explain_instruction = (
        "\n\n[출력 규칙 — 반드시 준수]\n"
        "마크다운 헤더(#, ##, ###, ####) 절대 사용 금지.\n"
        "교차로별 변경사항을 아래 형식으로 간단히 출력 (빈 줄로 구분):\n\n"
        "• 교차로명\n"
        "  현시N (방향): Xs → Ys\n\n"
        "변경 이유를 혼잡등급·주기 방향 중심으로 1~2문장 덧붙여줘. "
        "'기대됩니다', '향상될 것' 등 근거 없는 효과 추정 금지."
    )

    prompt = (
        f"서울 신호 시뮬레이션 시스템이야. 반드시 한국어로 답해줘."
        f"{ctx_block}"
        f"{sim_block}"
        f"{traffic_block}"
        f"{calc_block}"
        f"{explain_instruction}\n\n"
        f"질문: {req.question}"
    )

    print(f"\n[SIM-CHAT PROMPT — 총 {len(prompt)}자]\n{prompt}\n", flush=True)
    response = await sim_llm.ainvoke(prompt)
    raw = response.content if hasattr(response, "content") else str(response)
    print(f"\n[SIM-CHAT RAW — {len(raw)}자]\n{raw[:1200]}\n", flush=True)
    if isinstance(raw, list):
        raw = " ".join(item.get("text", "") if isinstance(item, dict) else str(item) for item in raw).strip()
    if "<think>" in raw:
        after = raw.split("</think>")[-1].strip()
        raw = after if after else raw.split("<think>", 1)[-1].split("</think>")[0].strip()

    clean_answer = raw.strip()
    # LLM이 [REPORT] 태그를 남겼다면 화면 표시에서 제거
    if "[REPORT]" in clean_answer:
        clean_answer = clean_answer.split("[REPORT]", 1)[0].strip()

    if not clean_answer and adjustments:
        clean_answer = "경로 내 병목 구간의 실시간 속도와 신호계획을 분석하여 주기를 조정했습니다."
    elif not clean_answer:
        clean_answer = "신호계획을 분석했습니다. 현재 구간의 속도 데이터를 확인하세요."

    print(f"\n[SIM-CHAT ANSWER (UI용 요약)]\n{clean_answer}\n", flush=True)
    print(f"[SIM-CHAT REPORT (Python 생성 — {len(email_report) if email_report else 0}자)]\n", flush=True)

    return ChatResponse(
        answer=clean_answer,
        adjustment=adjustments[0] if adjustments and len(adjustments) == 1 else None,
        adjustments=adjustments,
        report=email_report,
    )


@app.post("/api/agent/simulation-chat/stream")
async def simulation_chat_stream(req: SimulationChatRequest, request: Request):
    """시뮬레이션 챗 SSE 스트리밍 — 토큰 단위 실시간 전송"""
    import json as _json

    # 동일한 프롬프트 조립 (simulation_chat 과 동일 로직)
    ctx_block = ""
    if req.contexts:
        parts = []
        for c in req.contexts:
            name = c.get("intNm") or c.get("intNo") or "?"
            # 신호계획 요약만 (토큰 절약)
            phases = c.get("phases", [])
            phase_str = ", ".join(f"현시{p.get('no')}:{p.get('sec')}s({'/'.join(p.get('dirs',[]))})" for p in phases)
            parts.append(f"[신호계획 - {name} (intNo:{c.get('intNo')})] cycleVal={c.get('cycleVal')}s | {phase_str}")
        ctx_block = "\n\n" + "\n".join(parts)
    elif req.context:
        c = req.context
        phases = c.get("phases", [])
        phase_str = ", ".join(f"현시{p.get('no')}:{p.get('sec')}s({'/'.join(p.get('dirs',[]))})" for p in phases)
        ctx_block = f"\n\n[신호계획 - {c.get('intNm') or c.get('intNo')} (intNo:{c.get('intNo')})] cycleVal={c.get('cycleVal')}s | {phase_str}"

    sim_block = ""
    if req.simulation:
        sim_block = (
            f"\n\n[관제사 조정값]\n"
            f"{_json.dumps(req.simulation, ensure_ascii=False, indent=2)}\n"
            f"원래 신호계획과 비교해서 어떤 현시가 얼마나 바뀌었는지 분석해줘."
        )

    _DIR_KO = {"north":"북","east":"동","south":"남","west":"서",
               "northeast":"북동","northwest":"북서","southeast":"남동","southwest":"남서"}

    traffic_block = ""
    if req.routeTraffic:
        lines = []
        for seg in req.routeTraffic:
            spd = seg.get("speedKph")
            mark = " ★병목" if spd is not None and spd < 15 else ""
            spd_by_dir = seg.get("speedByDirection") or {}
            dir_parts = [f"{_DIR_KO.get(k, k)} {v}km/h" for k, v in spd_by_dir.items() if v is not None]
            dir_str = f" [{', '.join(dir_parts)}]" if dir_parts else ""
            lines.append(f"  {seg.get('fromIntNo')}→{seg.get('toIntNo')} | 평균 {spd}km/h{dir_str}{mark}")
        traffic_block = "\n\n[경로 속도 — 15km/h↓ 병목]\n" + "\n".join(lines)

    # ── Python 먼저 계산 ──────────────────────────────────────────────────────────
    _contexts_list = req.contexts if req.contexts else ([req.context] if req.context else [])
    _adjustments, _calc_details = compute_webster_adjustments(_contexts_list, req.routeTraffic or [])
    _calc_block = _build_calc_block(_calc_details) if _calc_details else ""

    _explain_instruction = (
        "\n\n[출력 규칙 — 반드시 준수]\n"
        "마크다운 헤더(#, ##, ###, ####) 절대 사용 금지.\n"
        "교차로별 변경사항을 아래 형식으로 간단히 출력 (빈 줄로 구분):\n\n"
        "• 교차로명\n"
        "  현시N (방향): Xs → Ys\n\n"
        "변경 이유를 혼잡등급·주기 방향 중심으로 1~2문장 덧붙여줘. "
        "'기대됩니다', '향상될 것' 등 근거 없는 효과 추정 금지."
    )

    prompt = (
        f"서울 신호 시뮬레이션이야. 한국어로 답해줘."
        f"{ctx_block}{sim_block}{traffic_block}{_calc_block}{_explain_instruction}\n\n질문: {req.question}"
    )

    async def generate():
        full_text = ""
        in_think = False
        # adjustments는 Python 계산값 고정 사용
        adjustments = _adjustments
        try:
            async for chunk in sim_llm.astream(prompt):
                if await request.is_disconnected():
                    return
                token = chunk.content if hasattr(chunk, "content") else str(chunk)
                if not token:
                    continue
                full_text += token

                # <think> 블록은 스트리밍 안 함
                if "<think>" in full_text and "</think>" not in full_text:
                    in_think = True
                    continue
                if in_think and "</think>" in full_text:
                    in_think = False
                    continue
                if in_think:
                    continue

                yield f"data: {_json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"

            if "<think>" in full_text:
                full_text = full_text.split("</think>")[-1].strip() or full_text
            clean = full_text.strip()
            if not clean and adjustments:
                clean = "신호계획을 분석하여 직진 현시 우선으로 녹색시간을 재배분했습니다."
            elif not clean:
                clean = "신호계획을 분석했습니다."
            yield f"data: {_json.dumps({'type': 'done', 'answer': clean, 'adjustments': adjustments}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {_json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/agent/bottleneck-email", response_model=ChatResponse)
async def bottleneck_email(req: DistrictRequest):
    """병목 리포트 텍스트만 생성 — 메일 발송은 Spring이 담당"""
    prompt = (
        f"/no_think\n"
        f"[중요] 반드시 한국어로만 작성할 것. 중국어·영어 등 다른 언어 사용 절대 금지.\n\n"
        f"get_district_traffic 도구로 서울 {req.district} 교통 데이터를 조회해줘.\n"
        f"조회 결과를 바탕으로 아래 형식을 그대로 지켜서 리포트 본문만 출력해줘. 다른 말은 절대 하지 말고 양식 그대로만 출력.\n\n"
        f"교통관제 자동화 시스템입니다.\n"
        f"{req.district} 내 15km/h 이하 구간이 감지되어 경보를 발송합니다.\n"
        f"관제사께서는 아래 내용을 확인하시고 필요한 조치를 취해주시기 바랍니다.\n\n"
        f"[병목 구간 현황]\n"
        f"기준: 15km/h 이하 구간\n"
        f"수집 교차로: {{total_crossroads}}개\n\n"
        f"순위 | 교차로명                | 현재속도\n"
        f"-----|------------------------|------------\n"
        f"(병목 교차로를 위 표 형식으로 순위별로 작성. 없으면 '해당 없음' 한 줄)\n\n"
        f"[날씨 현황]\n"
        f"기온 {{temperatureC}}°C / 강수량 {{precipitationMm}}mm / 풍속 {{windSpeedMs}}m/s\n\n"
        f"[시스템 분석 및 조치 권고]\n"
        f"(혼잡 원인 추정 + 신호 조정 또는 우회 권고 2~3문장. 반드시 한국어로 작성)\n\n"
        f"---\n"
        f"본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\n"
        f"조치 후 관제 시스템에서 결과를 확인해 주시기 바랍니다.\n"
        f"감사합니다.\n\n"
        f"Syncro 교통 관제 시스템 드림\n\n"
        f"병목 교차로가 없으면 아래 양식만 출력:\n"
        f"교통관제 자동화 시스템입니다.\n"
        f"현재 {req.district} 내 15km/h 이하 구간이 감지되지 않았습니다.\n"
        f"수집 교차로: {{total_crossroads}}개 / 현재 교통 상황 양호\n\n"
        f"---\n"
        f"본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\n"
        f"감사합니다.\n\n"
        f"Syncro 교통 관제 시스템 드림"
    )
    result = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]})
    return ChatResponse(answer=strip_chinese(extract_answer(result)))


@app.post("/api/agent/bottleneck-email/stream")
async def bottleneck_email_stream(req: DistrictRequest, request: Request):
    """병목 이메일 SSE 스트리밍 — 리포트 생성 후 Spring으로 메일 발송"""
    import json as _json
    import httpx as _httpx

    prompt = (
        f"/no_think\n"
        f"[중요] 반드시 한국어로만 작성할 것. 중국어·영어 등 다른 언어 사용 절대 금지.\n\n"
        f"get_district_traffic 도구로 서울 {req.district} 교통 데이터를 조회해줘.\n"
        f"조회 결과를 바탕으로 아래 형식을 그대로 지켜서 리포트 본문만 출력해줘. 다른 말은 절대 하지 말고 양식 그대로만 출력.\n\n"
        f"교통관제 자동화 시스템입니다.\n"
        f"{req.district} 내 15km/h 이하 구간이 감지되어 경보를 발송합니다.\n"
        f"관제사께서는 아래 내용을 확인하시고 필요한 조치를 취해주시기 바랍니다.\n\n"
        f"[병목 구간 현황]\n기준: 15km/h 이하 구간\n수집 교차로: {{total_crossroads}}개\n\n"
        f"순위 | 교차로명 | 현재속도\n"
        f"(병목 교차로를 순위별로 작성. 없으면 '해당 없음' 한 줄)\n\n"
        f"[날씨 현황]\n기온 {{temperatureC}}°C / 강수량 {{precipitationMm}}mm / 풍속 {{windSpeedMs}}m/s\n\n"
        f"[시스템 분석 및 조치 권고]\n(혼잡 원인 추정 + 신호 조정 또는 우회 권고 2~3문장. 반드시 한국어로 작성)\n\n"
        f"---\n"
        f"본 메일은 Syncro 교통 관제 시스템에서 자동 발송되었습니다.\n"
        f"조치 후 관제 시스템에서 결과를 확인해 주시기 바랍니다.\n"
        f"감사합니다.\n\n"
        f"Syncro 교통 관제 시스템 드림"
    )

    async def generate():
        report_text = ""
        try:
            async for msg_kind, event in agent_stream_with_cancel(request, prompt):
                if msg_kind == "error":
                    yield f"data: {_json.dumps({'type': 'error', 'content': str(event)}, ensure_ascii=False)}\n\n"
                    return
                kind = event["event"]
                name = event.get("name", "")

                if kind == "on_tool_start":
                    args = event["data"].get("input", {})
                    args_str = ", ".join(f"{k}={v}" for k, v in args.items()) if args else ""
                    data = {"type": "action", "tool": name, "label": TOOL_LABELS.get(name, name), "args": args_str}
                    yield f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"

                elif kind == "on_tool_end":
                    output = event["data"].get("output")
                    obs = ""
                    if output is not None:
                        raw = str(output.content) if hasattr(output, "content") else str(output)
                        try:
                            parsed = _json.loads(raw)
                            if isinstance(parsed, dict):
                                keys = list(parsed.keys())[:4]
                                obs = "{ " + ", ".join(keys) + (" ..." if len(parsed) > 4 else "") + " }"
                            elif isinstance(parsed, list):
                                obs = f"[{len(parsed)}개 항목 반환]"
                            else:
                                obs = raw[:150]
                        except Exception:
                            obs = raw[:150]
                    yield f"data: {_json.dumps({'type': 'observation', 'content': obs}, ensure_ascii=False)}\n\n"

                elif kind == "on_chat_model_end":
                    output = event["data"].get("output")
                    if not output:
                        continue
                    has_tool_calls = bool(getattr(output, "tool_calls", None))
                    content = output.content if hasattr(output, "content") else ""
                    if isinstance(content, list):
                        content = " ".join(
                            item.get("text", "") if isinstance(item, dict) else str(item)
                            for item in content
                        ).strip()

                    if content and "<think>" in content:
                        inside = content.split("<think>", 1)[-1].split("</think>")[0].strip()
                        if inside:
                            yield f"data: {_json.dumps({'type': 'thought', 'content': inside[:200]}, ensure_ascii=False)}\n\n"

                    if not has_tool_calls and content:
                        if "<think>" in content:
                            after = content.split("</think>")[-1].strip()
                            content = after if after else content
                        if content:
                            content = strip_chinese(content)
                            report_text = content
                            yield f"data: {_json.dumps({'type': 'answer', 'content': content}, ensure_ascii=False)}\n\n"

            # 리포트 완성 → Spring EmailService로 메일 발송
            if report_text and req.userEmail:
                try:
                    async with _httpx.AsyncClient(timeout=10.0) as client:
                        await client.post(
                            "http://localhost:8080/api/email/send",
                            json={"to": req.userEmail, "subject": f"[Syncro] 서울 {req.district} 분석결과를 알려드립니다", "body": report_text},
                        )
                    yield f"data: {_json.dumps({'type': 'observation', 'content': f'메일 발송 완료 → {req.userEmail}'}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    yield f"data: {_json.dumps({'type': 'observation', 'content': f'메일 발송 실패: {e}'}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {_json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/agent/district-report/stream")
async def district_report_stream(req: DistrictRequest, request: Request):
    """구 단위 리포트 SSE 스트리밍 — 메인 대시보드 토스트 시각화용"""
    import json as _json

    prompt = (
        f"/no_think\n"
        f"get_district_traffic 도구로 서울 {req.district} 교통 데이터를 조회한 뒤, "
        f"반드시 한국어로 아래 형식으로 간결하게 리포트 작성해줘:\n"
        f"## {req.district} 교통 현황\n"
        f"**수집 교차로**: N개\n"
        f"**평균 속도**: X km/h\n"
        f"**15km/h 이하 병목**: 교차로명 (속도 km/h, 위험등급) 목록\n"
        f"**신호 조정 권고**: 혼잡 원인과 권고 2~3문장"
    )

    async def generate():
        try:
            async for msg_kind, event in agent_stream_with_cancel(request, prompt):
                if msg_kind == "error":
                    yield f"data: {_json.dumps({'type': 'error', 'content': str(event)}, ensure_ascii=False)}\n\n"
                    return
                kind = event["event"]
                name = event.get("name", "")

                if kind == "on_tool_start":
                    args = event["data"].get("input", {})
                    args_str = ", ".join(f"{k}={v}" for k, v in args.items()) if args else ""
                    data = {
                        "type": "action",
                        "tool": name,
                        "label": TOOL_LABELS.get(name, name),
                        "args": args_str,
                    }
                    yield f"data: {_json.dumps(data, ensure_ascii=False)}\n\n"

                elif kind == "on_tool_end":
                    output = event["data"].get("output")
                    obs = ""
                    if output is not None:
                        raw = str(output.content) if hasattr(output, "content") else str(output)
                        try:
                            parsed = _json.loads(raw)
                            if isinstance(parsed, dict):
                                keys = list(parsed.keys())[:4]
                                obs = "{ " + ", ".join(keys) + (" ..." if len(parsed) > 4 else "") + " }"
                            elif isinstance(parsed, list):
                                obs = f"[{len(parsed)}개 항목 반환]"
                            else:
                                obs = raw[:150]
                        except Exception:
                            obs = raw[:150]
                    yield f"data: {_json.dumps({'type': 'observation', 'content': obs}, ensure_ascii=False)}\n\n"

                elif kind == "on_chat_model_end":
                    output = event["data"].get("output")
                    if not output:
                        continue
                    has_tool_calls = bool(getattr(output, "tool_calls", None))
                    content = output.content if hasattr(output, "content") else ""
                    if isinstance(content, list):
                        content = " ".join(
                            item.get("text", "") if isinstance(item, dict) else str(item)
                            for item in content
                        ).strip()

                    if content and "<think>" in content:
                        inside = content.split("<think>", 1)[-1].split("</think>")[0].strip()
                        if inside:
                            yield f"data: {_json.dumps({'type': 'thought', 'content': inside[:200]}, ensure_ascii=False)}\n\n"

                    if not has_tool_calls and content:
                        if "<think>" in content:
                            after = content.split("</think>")[-1].strip()
                            content = after if after else content
                        if content:
                            yield f"data: {_json.dumps({'type': 'answer', 'content': content}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {_json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/agent/district-report", response_model=ReportResponse)
async def district_report(req: DistrictRequest):
    """메인 대시보드 구 단위 리포트"""

    prompt = (
        f"/no_think\n"
        f"get_district_traffic 도구로 서울 {req.district} 교통 데이터를 조회한 뒤, "
        f"반드시 한국어로 아래 형식으로 간결하게 리포트 작성해줘:\n"
        f"## {req.district} 교통 현황\n"
        f"**수집 교차로**: N개\n"
        f"**평균 속도**: X km/h\n"
        f"**20km/h 이하 병목**: 교차로명 (속도 km/h, 위험등급) 목록\n"
        f"**신호 조정 권고**: 혼잡 원인과 권고 2~3문장"
    )

    result = await agent.ainvoke({"messages": [{"role": "user", "content": prompt}]})
    return ReportResponse(report=extract_answer(result), district=req.district)


# ── 멀티에이전트: 방향별 주변 교차로 분석 ──────────────────────────────────────────

@app.post("/api/agent/multi-analyze/stream")
async def multi_analyze_stream(req: MultiAnalyzeRequest, request: Request):
    """방향별(N/S/E/W) 워커 에이전트 병렬 분석 + 오케스트레이터 종합 SSE"""
    import json as _json

    async def generate():
        try:
            # 1. 인근 교차로 조회 — 100m 고정, 없으면 없는 대로 진행
            async with httpx.AsyncClient(timeout=10.0) as cl:
                nearby_r = await cl.get(
                    f"{SPRING_BASE}/api/crossroads/nearby",
                    params={"lat": req.lat, "lon": req.lon, "radius": 0.3},
                )
                nearby = nearby_r.json() if nearby_r.status_code == 200 else []
            directional = select_directional(req.lat, req.lon, nearby) if nearby else []

            if not directional:
                yield f"data: {_json.dumps({'type':'error','content':'인근 교차로가 없습니다.'}, ensure_ascii=False)}\n\n"
                return

            # 3. 전체 신호 캐시 → crsrdId 기준 맵
            async with httpx.AsyncClient(timeout=10.0) as cl:
                sig_r = await cl.get(f"{SPRING_BASE}/api/signals")
                raw   = sig_r.json() if sig_r.status_code == 200 else []
            signals_map = {s['crsrdId']: s for s in (raw if isinstance(raw, list) else raw.values()) if 'crsrdId' in s}

            # 4. 분석 시작 이벤트 (중심+방향 교차로 좌표 전송)
            yield f"data: {_json.dumps({'type':'analyze_init','center':{'lat':req.lat,'lon':req.lon},'workers':[{'worker_id':i+1,'direction':DIR_KO.get(d,d),'crossroad_name':cr['crsrdNm'],'lat':cr['lat'],'lon':cr['lon']} for i,(cr,d) in enumerate(directional)]}, ensure_ascii=False)}\n\n"

            # 5. 워커 병렬 실행
            queue: asyncio.Queue = asyncio.Queue()
            tasks = [
                asyncio.create_task(
                    _worker_analyze(
                        worker_llms[i % len(worker_llms)],
                        cr, signals_map.get(cr['crsrdId']),
                        i + 1, direction, queue
                    )
                )
                for i, (cr, direction) in enumerate(directional)
            ]

            # 5. 워커 이벤트 스트리밍
            worker_results = []
            done_count = 0
            while done_count < len(tasks):
                if await request.is_disconnected():
                    for t in tasks: t.cancel()
                    return
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=0.3)
                except asyncio.TimeoutError:
                    continue
                yield f"data: {_json.dumps(msg, ensure_ascii=False)}\n\n"
                if msg['type'] == 'worker_done':
                    worker_results.append(msg)
                    done_count += 1

            await asyncio.gather(*tasks, return_exceptions=True)

            # 6. 라운드 2/3/4 — 워커 3라운드 순차 토론
            yield f"data: {_json.dumps({'type':'discussion_start'}, ensure_ascii=False)}\n\n"

            center_nm = req.crsrdNm or f"({req.lat:.4f},{req.lon:.4f})"
            discuss_results = []
            # 데이터 없는 워커는 토론에서 제외 (없는 숫자 지어내는 것 방지)
            ordered_workers = sorted(
                [r for r in worker_results if r.get('has_data', True)],
                key=lambda x: x['worker_id']
            )
            num_workers     = len(ordered_workers)

            STRICT_RULE = (
                "\n\n[엄격 규칙]\n"
                "✓ 언급 가능: 속도(km/h), 혼잡, 위험도, 유입 압력 수준(높음/낮음)\n"
                "✗ 금지: 차량 대수('약 N대', '많은 차량'), 교통량 수치\n"
                "✗ 금지: '+N초', '신호 연장', 신호 조정 수치 ← 수치 결정은 오케스트레이터만\n"
                "✗ 금지: '운전자', '권장드립니다', '안전하게'"
            )

            ROUND_INSTRUCTIONS = [
                # 1라운드: 자기 교차로 방향별 속도 + 유입 압력 공유
                lambda dk, nm, last, cnm=center_nm: (
                    f"너는 {dk}쪽 {nm} 담당 에이전트야. [1라운드: 방향별 속도 공유]\n"
                    f"위 '내 담당 교차로' 데이터만 사용해서 자연스러운 2문장으로 보고해.\n"
                    f"  · 첫 문장: {dk}쪽 {nm}의 방향별 속도 나열 (없는 방향은 '없음')\n"
                    f"  · 둘째 문장: {cnm} {dk}방향 유입 압력 수준\n"
                    f"금지: '1문장' '2문장' 같은 레이블 출력, '+N초', 다른 교차로 수치를 내 것처럼 사용"
                    + STRICT_RULE
                ),
                # 2라운드: 방향별 우선순위 논의
                lambda dk, nm, last, cnm=center_nm: (
                    f"너는 {dk}쪽 {nm} 담당 에이전트야. [2라운드: 우선순위 논의]\n"
                    f"다른 방향들과 비교해서 {dk}방향 압력의 우선순위를 2문장으로 말해.\n"
                    f"금지: '+N초', 신호 조정 수치, 형식 설명 텍스트 출력"
                    + STRICT_RULE
                ),
                # 3라운드: 압력 우선순위 합의
                lambda dk, nm, last, cnm=center_nm: (
                    (
                        f"너는 {dk}쪽 {nm} 담당 에이전트야. [3라운드: 최종 합의]\n"
                        f"방향별 유입 압력 순위를 정리해서 오케스트레이터에게 합의안 2문장으로 전달.\n"
                        f"형식: '합의: X>Y>Z 순으로 압력 높음. 이 순서로 신호 조정 권고.'\n"
                        f"금지: '+N초', 신호 조정 수치, 형식 설명 텍스트 출력"
                    ) if last else (
                        f"너는 {dk}쪽 {nm} 담당 에이전트야. [3라운드: 합의]\n"
                        f"{dk}방향 압력 우선순위에 동의/수정 1문장.\n"
                        f"금지: 형식 설명 텍스트 출력"
                    ) + STRICT_RULE
                ),
            ]

            for round_num in range(1, 4):
                yield f"data: {_json.dumps({'type':'round_start','round':round_num}, ensure_ascii=False)}\n\n"

                for i, r in enumerate(ordered_workers):
                    if await request.is_disconnected():
                        return
                    dir_ko  = r['direction']
                    nm      = r['crossroad_name']
                    is_last = (round_num == 3 and i == num_workers - 1)

                    yield f"data: {_json.dumps({'type':'discuss_start','round':round_num,'worker_id':r['worker_id'],'direction':dir_ko,'crossroad_name':nm}, ensure_ascii=False)}\n\n"

                    analyses = "\n".join(
                        f"[{a['direction']}쪽 {a['crossroad_name']}] {a['content']}"
                        for a in worker_results
                    )
                    chat_so_far = "\n".join(
                        f"[R{d['round']} {d['direction']}쪽 {d['crossroad_name']}]: {d['content']}"
                        for d in discuss_results
                    ) if discuss_results else "없음"

                    # 현재 워커 자신의 1차 분석만 분리
                    my_analysis = next(
                        (f"[내 담당 교차로 — {a['direction']}쪽 {a['crossroad_name']}]\n{a['content']}"
                         for a in worker_results if a['direction'] == dir_ko),
                        ""
                    )
                    other_analyses = "\n".join(
                        f"[{a['direction']}쪽 {a['crossroad_name']}] {a['content']}"
                        for a in worker_results if a['direction'] != dir_ko
                    )

                    instruction = ROUND_INSTRUCTIONS[round_num - 1](dir_ko, nm, is_last)
                    prompt = (
                        f"/think 반드시 한국어로만 답변하십시오.\n\n"
                        f"[상황] 서울 교통 관제 센터 AI 에이전트 내부 회의.\n\n"
                        f"⚠️ 너의 담당 교차로 수치만 사용할 것. 다른 교차로 수치를 네 것처럼 쓰지 말 것.\n\n"
                        f"{my_analysis}\n\n"
                        f"[다른 에이전트 분석 — 참고만]\n{other_analyses}\n\n"
                        f"[지금까지 토론]\n{chat_so_far}\n\n"
                        f"{instruction}"
                    )
                    try:
                        result  = await worker_llms[i % len(worker_llms)].ainvoke(
                            [{"role": "user", "content": prompt}]
                        )
                        content = strip_chinese((result.content if hasattr(result, 'content') else str(result)).strip())
                    except Exception as e:
                        content = f"오류: {e}"

                    yield f"data: {_json.dumps({'type':'discuss_done','round':round_num,'worker_id':r['worker_id'],'direction':dir_ko,'crossroad_name':nm,'content':content}, ensure_ascii=False)}\n\n"

                    discuss_results.append({
                        'round': round_num, 'worker_id': r['worker_id'],
                        'direction': dir_ko, 'crossroad_name': nm, 'content': content
                    })

            # 7. 오케스트레이터 종합
            analysis_block = "\n\n".join(
                f"[워커{r['worker_id']} {r['direction']}쪽 {r['crossroad_name']}]\n{r['content']}"
                for r in worker_results
            )
            discuss_block = ""
            for rn in range(1, 4):
                rnd_items = [d for d in discuss_results if d['round'] == rn]
                if rnd_items:
                    discuss_block += f"[토론 {rn}라운드]\n"
                    discuss_block += "\n".join(
                        f"W{d['worker_id']}({d['direction']}): {d['content']}" for d in rnd_items
                    ) + "\n\n"
            # 오케스트레이터용 Python 계산 결과 블록 (LLM이 계산 안 하도록)
            calc_lines = []
            for r in worker_results:
                if r.get('has_data') and r.get('delta') is not None:
                    sign = "+" if r['delta'] >= 0 else ""
                    by_dir = r.get('spd_by_dir') or {}
                    dir_parts = [f"{_WORKER_DIR_KO.get(k, k)} {v}km/h" for k, v in by_dir.items() if v is not None]
                    dir_str = f" [방향별: {', '.join(dir_parts)}]" if dir_parts else ""
                    calc_lines.append(
                        f"  {r['direction']}방향 ({r['crossroad_name']}): "
                        f"평균 {r.get('speed', 'N/A')}km/h {r.get('state', '')}{dir_str} "
                        f"→ 권고 {sign}{r['delta']}초"
                    )
                else:
                    calc_lines.append(
                        f"  {r['direction']}방향 ({r['crossroad_name']}): 데이터 없음 → 현장 확인 필요"
                    )
            calc_block = "\n".join(calc_lines)

            orch_prompt = (
                f"/think 반드시 한국어로만 답변하십시오.\n\n"
                f"=== {center_nm} 신호 조정 권고 ===\n\n"
                f"[코드 계산 결과 — 이 수치를 그대로 사용, 임의 변경 금지]\n"
                f"{calc_block}\n\n"
                f"[에이전트 토론 요약 (우선순위 참고용)]\n{discuss_block}\n"
                f"아래 순서대로 반드시 모두 작성하세요 (순서 바꾸거나 항목 생략 금지):\n\n"
                f"① 현황 요약\n"
                f"   데이터 있는 방향마다 아래 형식으로 한 줄씩 출력:\n"
                f"   · {{방향}}방향 ({{교차로명}}): 평균 Xkm/h | 북 Akm/h · 동 Bkm/h · 서 Ckm/h · 남 Dkm/h (측정값없는 방향 생략) | {{상태}}\n"
                f"   ← 반드시 코드 계산 결과 [방향별] 수치를 그대로 사용할 것\n\n"
                f"② {center_nm} 신호 조정 권고안\n"
                f"   코드 계산값 그대로 (숫자 임의 변경 금지):\n"
                f"   · {{방향}}방향: +N초 (또는 데이터없음이면 '현장 확인 필요')\n\n"
                f"③ 예상 효과 1~2문장\n\n"
                f"금지: 마크다운 헤더(###, ####, ##), 마무리 인사말, ① 현황 요약 생략"
            )

            yield f"data: {_json.dumps({'type':'orchestrator_start'}, ensure_ascii=False)}\n\n"

            orch_result = await agent.ainvoke({"messages": [{"role": "user", "content": orch_prompt}]})
            orch_text   = strip_chinese(extract_answer(orch_result))

            yield f"data: {_json.dumps({'type':'orchestrator_done','content':orch_text}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {_json.dumps({'type':'error','content':str(e)}, ensure_ascii=False)}\n\n"

        yield 'data: {"type":"done"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 실행 ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
