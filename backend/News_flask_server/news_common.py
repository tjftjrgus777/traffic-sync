"""
news_common.py — 공통 클래스 모음
  - ModelManager     : BERT / TF-IDF 모델 싱글톤 로딩
  - ArticleProcessor : 본문 비동기 수집, 텍스트 정제, BERT 추론, 필터링
  - GroqAnalyzer     : 비동기 요약 + 감성 분석 (API 키 별도 지정 가능)
  - DatabaseManager  : Oracle DB 즉시 단건 삽입
  - run_pipeline_async: 전체 수집 파이프라인
"""

import os
import re
import json
import asyncio
import joblib
import threading
import aiohttp
import oracledb
import torch
import torch.nn as nn
import torch.nn.functional as F
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from bs4 import BeautifulSoup
from konlpy.tag import Okt
from datetime import datetime
from openai import AsyncOpenAI
from transformers import BertModel, BertTokenizerFast
import time


# ================================================================
# [공통 필터 단어]
# ================================================================
EXCLUDE_WORDS = [
    "사형", "징역", "검찰", "구속", "당대표", "정당", "비서관", "정치", "의원",
    "대통령", "국회", "여당", "야당", "선거", "총선", "대선", "경찰", "수사",
    "장관", "공직자", "고위직", "재산", "윤리위원회",
    "다주택", "청약", "아파트", "전세", "부동산", "분양"
]

TITLE_EXCLUDE_WORDS = [
    "시황", "마감", "특징주", "인사이트", "증시", "코스피", "코스닥", "종합",
    "순매수", "순매도", "동반 상승", "동반 하락", "외인", "기관", "뉴욕증시",
    "관련주", "테마주", "수혜주", "급등주", "종목추천"
]


# ================================================================
# [BERT 모델 구조]
# ================================================================
class BertBaseModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.bert = BertModel.from_pretrained("kykim/bert-kor-base")
        self.cls  = nn.Linear(768, 4)

    def forward(self, input_ids, attention_mask):
        return self.cls(
            self.bert(input_ids=input_ids, attention_mask=attention_mask)[1]
        )


# ================================================================
# [ModelManager — 싱글톤]
# ================================================================
class ModelManager:
    """BERT + TF-IDF 모델을 한 번만 로드. 두 파이프라인이 공유."""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"장치: {self.device}")
        self._load_logistic()
        self._load_bert()

    def _load_logistic(self):
        print("로지스틱 회귀 모델 로딩 중...")
        try:
            self.lr_model= joblib.load('clickbait_model.joblib')
            self.lr_vectorizer = joblib.load('tfidf_vectorizer.joblib')
            print("✅ 로지스틱 회귀 로딩 완료!")
        except Exception as e:
            print(f"❌ 로딩 실패: {e}")
            self.lr_model      = None
            self.lr_vectorizer = None

    def _load_bert(self):
        try:
            import __main__
            __main__.BertBaseModel = BertBaseModel  # pickle이 __main__에서 찾으므로 주입
            self.bert_model = torch.load(
                './model.pt', map_location=self.device, weights_only=False
            )
            self.bert_model.to(self.device)
            self.bert_model.eval()
            self.tokenizer = BertTokenizerFast.from_pretrained("kykim/bert-kor-base")
            print("✅ BERT 로딩 완료!")
        except Exception as e:
            print(f"❌ BERT 로딩 실패: {e}")
            self.bert_model = None
            self.tokenizer  = None


# ================================================================
# [ArticleProcessor]
# ================================================================
class ArticleProcessor:
    """본문 비동기 수집 / 텍스트 정제 / BERT 추론 / 필터링."""

    def __init__(self, model_manager: ModelManager):
        self.mm        = model_manager
        self.okt       = Okt()
        self._okt_lock = threading.Lock()  # KoNLPy 스레드 비안전 → 락

    # ------ 비동기 본문 수집 ------
    async def fetch_content(self, session: aiohttp.ClientSession, url: str) -> str | None:
        try:
            headers = {"User-Agent": "Mozilla/5.0"}
            timeout = aiohttp.ClientTimeout(total=5)
            async with session.get(url, headers=headers, timeout=timeout) as resp:
                if resp.status != 200:
                    return None
                html    = await resp.text()
                soup    = BeautifulSoup(html, "html.parser")
                content = soup.select_one("#dic_area, #newsct_article, #articeBody")
                if content:
                    text = content.get_text(" ", strip=True)
                    return text if text else None
                return None
        except Exception:
            return None

    # ------ 텍스트 정제 + 청크 분리 ------
    def clean_and_split(self, full_text: str, max_chars: int = 100) -> list:
        if not full_text:
            return []
        text = re.sub(r'[a-zA-Z0-9+-_.]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', '', full_text)
        text = re.sub(r'©.*|Copyright.*|무단\s*전재.*|배포\s*금지.*', '', text)
        text = re.sub(r'\S+\s*기자', '', text)
        text = re.sub(r'https?://\S+', '', text)
        text = re.sub(r'\[.*?\]|\(.*?사진.*?\)|\(.*?제공.*?\)', '', text)
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n{2,}', '\n', text)
        text = text.strip()

        sentences_raw = re.split(r'(?<=[다요음임])\.\s+|\n', text)
        sentences     = [s.strip() for s in sentences_raw if len(s.strip()) > 20]
        if not sentences:
            return []

        chunks, current_chunk = [], ""
        for sentence in sentences:
            if len(current_chunk) + len(sentence) <= max_chars:
                current_chunk += (" " + sentence) if current_chunk else sentence
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence
        if current_chunk:
            chunks.append(current_chunk.strip())
        return chunks

    # ------ BERT 기사 유형 분류 (동기 → run_in_executor로 호출) ------
    def predict_type(self, paragraphs: list) -> tuple[str, float]:
        mm = self.mm
        if not paragraphs or mm.bert_model is None:
            return "알 수 없음", 0.0

        class_names         = ["사실형", "예측형", "대화형", "추론형"]
        predicted_labels    = []
        chunk_confidences   = []
        all_probs_per_chunk = []

        mm.bert_model.eval()
        with torch.no_grad():
            for p in paragraphs:
                inputs = mm.tokenizer(
                    p, return_tensors="pt",
                    max_length=128, truncation=True, padding="max_length"
                )
                input_ids      = inputs['input_ids'].to(mm.device)
                attention_mask = inputs['attention_mask'].to(mm.device)
                outputs        = mm.bert_model(input_ids, attention_mask)
                probs          = F.softmax(outputs, dim=1).squeeze().tolist()
                max_idx        = probs.index(max(probs))
                predicted_labels.append(class_names[max_idx])
                chunk_confidences.append(max(probs))
                all_probs_per_chunk.append(probs)

        label_counts = Counter(predicted_labels)
        top_count    = label_counts.most_common(1)[0][1]
        top_labels   = [l for l, c in label_counts.items() if c == top_count]

        if len(top_labels) == 1:
            final_label = top_labels[0]
        else:
            avg_probs   = [sum(col) / len(col) for col in zip(*all_probs_per_chunk)]
            final_label = class_names[avg_probs.index(max(avg_probs))]

        win_confs  = [c for l, c in zip(predicted_labels, chunk_confidences)
                      if l == final_label]
        vote_ratio = len(win_confs) / len(predicted_labels)
        final_prob = (sum(win_confs) / len(win_confs)) * vote_ratio * 100
        return final_label, round(final_prob, 1)

    # ------ 과장성 점수 ------
    def predict_clickbait(self, title: str, text: str) -> float:
        mm = self.mm
        if not mm.lr_model or not mm.lr_vectorizer:
            return 0.0
        vec   = mm.lr_vectorizer.transform([title + " " + text])
        probs = mm.lr_model.predict_proba(vec)[0]
        return round(probs[0] * 100, 1)

    # ------ 섹터 필터 (동기 → run_in_executor로 호출) ------
    def verify_sector(self, title: str, text: str, keywords: list) -> bool:
        """CrawlingNaverApi용: keywords 단일 리스트"""
        if not text:
            return False
        for bad in TITLE_EXCLUDE_WORDS:
            if bad in title:
                return False
        for bad in EXCLUDE_WORDS:
            if bad in title or bad in text:
                return False
        if any(kw in title for kw in keywords):
            return True
        with self._okt_lock:
            nouns = self.okt.nouns(text)
        return sum(1 for n in nouns if n in keywords) >= 1

    def verify_company(
        self, title: str, text: str, core_keywords: list, sub_keywords: list
    ) -> bool:
        """CrawlingNaverTOP7용: core + sub keywords"""
        if not text:
            return False
        for bad in TITLE_EXCLUDE_WORDS:
            if bad in title:
                return False
        for bad in EXCLUDE_WORDS:
            if bad in title or bad in text:
                return False
        if not any(core in title for core in core_keywords):
            return False
        with self._okt_lock:
            nouns = self.okt.nouns(text)
        return sum(1 for n in nouns if n in sub_keywords) >= 1


# ================================================================
# [GroqAnalyzer — 비동기]
# ================================================================
class GroqAnalyzer:
    def __init__(self, api_keys: str | list = None):
        if api_keys is None:
            api_keys = [os.getenv("GROQ_API_KEY")]
        elif isinstance(api_keys, str):
            api_keys = [api_keys]
        self._clients = [
            AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=k)
            for k in api_keys if k
        ]
        self._idx = 0
        self._system_prompt = (
            "너는 서울 교통 뉴스 분석 전문가다.\n"
            "1. 반드시 유효한 JSON 형식으로만 응답한다.\n"
            "2. 'sentiment'는 [혼잡악화, 교통개선, 중립] 중 하나로만 선택한다.\n"
            "   - 혼잡악화: 사고, 도로통제, 정체 심화, 파업, 운행중단 등\n"
            "   - 교통개선: 신호 최적화, 도로 개통, 혼잡 해소, 교통 대책 등\n"
            "   - 중립: 단순 사실 전달, 영향 미미 등\n"
            "3. 'summary'는 1문장으로 핵심만 요약한다.\n"
            "4. 키는 'summary'와 'sentiment'만 사용한다."
        )

    async def analyze(self, title: str, full_text: str) -> dict:
        if not full_text:
            return {"summary": "본문 없음", "sentiment": "중립"}

        # 모든 키 순서대로 시도 (429면 다음 키로)
        n = len(self._clients)
        start = self._idx % n
        for i in range(n):
            key_idx = (start + i) % n
            client = self._clients[key_idx]
            try:
                response = await client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=[
                        {"role": "system", "content": self._system_prompt},
                        {"role": "user", "content": f"제목: {title}\n본문: {full_text[:800]}"}
                    ],
                    temperature=0.5,
                    response_format={"type": "json_object"}
                )
                self._idx = key_idx + 1
                result = json.loads(response.choices[0].message.content.strip())
                if result.get("sentiment") not in ["혼잡악화", "교통개선", "중립"]:
                    result["sentiment"] = "중립"
                return result
            except Exception as e:
                err_str = str(e)
                if "429" in err_str:
                    print(f"Groq 429 키#{key_idx} → 다음 키 시도")
                    await asyncio.sleep(1)
                    continue
                print(f"Groq 오류 (키#{key_idx}): {e}")
                return {"summary": "요약 오류", "sentiment": "중립"}

        return {"summary": "요약 오류 (모든 키 한도 초과)", "sentiment": "중립"}


# ================================================================
# [DatabaseManager — 즉시 단건 삽입]
# ================================================================
class DatabaseManager:
    WALLET_PATH = os.getenv(
        "ORACLE_WALLET_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wallet')
    )

    def connect(self):
        pwd = os.getenv("ORACLE_PASSWORD", "")
        return oracledb.connect(
            user=os.getenv("ORACLE_USER", "ADMIN"),
            password=pwd,
            dsn=os.getenv("ORACLE_DSN", "koreapoint_high"),
            config_dir=self.WALLET_PATH,
            wallet_location=self.WALLET_PATH,
            wallet_password=pwd
        )

    def save_one(self, news: dict, cursor, connection, table: str) -> bool:
        """처리 완료된 기사 1건을 즉시 삽입."""
        insert_sql = f"""
            INSERT INTO {table}
                (link, category, title, summary, sentiment,
                 pub_date, clickbait_prob, article_type, type_prob)
            VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9)
        """
        try:
            cursor.execute(insert_sql, [
                news['link'], news['category'], news['title'],
                news['summary'], news['sentiment'], news['date'],
                str(news['clickbait_prob']),
                news['article_type'], str(news['type_prob'])
            ])
            connection.commit()
            return True
        except oracledb.IntegrityError:
            return False  # 중복
        except Exception as e:
            print(f"  삽입 에러 [{news['title'][:10]}]: {e}")
            return False


# ================================================================
# [비동기 파이프라인]
# ================================================================
async def run_pipeline_async(
    sector_config: dict,
    verify_fn,                 # callable(proc, title, text, info) -> bool  [동기]
    db_table: str = "news_data",
    max_per_sector: int = 100,
    fetch_concurrency: int = 20,
    groq_concurrency: int = 5,
    groq_api_keys: str | list = None,  # 단일 키 또는 키 리스트 (라운드로빈)
) -> int:
    """
    전체 뉴스 수집 파이프라인.
    - 모든 섹터 네이버 API 동시 호출
    - 기사 본문 Semaphore(fetch_concurrency) 병렬 수집
    - BERT / okt 블로킹 → ThreadPoolExecutor 오프로드
    - Groq Semaphore(groq_concurrency) 병렬 + sleep 속도 제한
    - 처리 완료 즉시 asyncio.Queue → DB writer 단건 삽입
    반환값: DB 신규 삽입 건수
    """
    mm   = ModelManager()
    proc = ArticleProcessor(mm)
    groq = GroqAnalyzer(api_keys=groq_api_keys)
    db   = DatabaseManager()

    db_executor  = ThreadPoolExecutor(max_workers=1)  # DB 단일 스레드
    cpu_executor = ThreadPoolExecutor(max_workers=4)  # BERT / okt

    naver_headers = {
        "X-Naver-Client-Id":     os.getenv("NAVER_CLIENT_ID"),
        "X-Naver-Client-Secret": os.getenv("NAVER_CLIENT_SECRET")
    }

    fetch_sem    = asyncio.Semaphore(fetch_concurrency)
    groq_sem     = asyncio.Semaphore(groq_concurrency)
    result_queue = asyncio.Queue()

    seen_links    = set()
    seen_lock     = asyncio.Lock()
    sector_counts = {name: 0 for name in sector_config}
    loop          = asyncio.get_event_loop()

    # ── DB writer: 큐에서 꺼내 즉시 삽입, None 수신 시 종료 ──────────
    async def db_writer(connection, cursor):
        success = duplicate = 0
        while True:
            item = await result_queue.get()
            if item is None:
                break
            ok = await loop.run_in_executor(
                db_executor, db.save_one, item, cursor, connection, db_table
            )
            if ok:
                success += 1
                print(f"   💾 [{item['category']}] {item['title'][:20]}... 저장")
            else:
                duplicate += 1
            result_queue.task_done()
        return success, duplicate

    # ── 네이버 API 호출 ──────────────────────────────────────────────
    async def fetch_naver_items(sector_name: str, info: dict, session):
        await asyncio.sleep(0.1)  # 네이버 API 속도 제한
        api_url = (
            "https://openapi.naver.com/v1/search/news.json"
            f"?query={info['search_query']}&display=100&sort=date"
        )
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with session.get(api_url, headers=naver_headers, timeout=timeout) as resp:
                if resp.status != 200:
                    print(f"   네이버 API 오류 ({sector_name}): {resp.status}")
                    return sector_name, []
                data = await resp.json()
                return sector_name, data.get("items", [])
        except Exception as e:
            print(f"   에러 ({sector_name}): {e}")
            return sector_name, []

    # ── 기사 처리 ────────────────────────────────────────────────────
    async def process_article(sector_name: str, info: dict, item: dict, session):
        link = item["link"]

        async with seen_lock:
            if link in seen_links or sector_counts[sector_name] >= max_per_sector:
                return
            seen_links.add(link)

        # 본문 수집
        async with fetch_sem:
            full_text = await proc.fetch_content(session, link)
        if not full_text:
            full_text = (
                item.get("description", "")
                .replace("<b>", "").replace("</b>", "")
            )

        clean_title = (
            item["title"]
            .replace("<b>", "").replace("</b>", "")
            .replace("&quot;", '"')
        )

        # 관련도 필터 (okt 포함 → 스레드풀)
        passed = await loop.run_in_executor(
            cpu_executor, verify_fn, proc, clean_title, full_text, info
        )
        if not passed:
            return

        async with seen_lock:
            if sector_counts[sector_name] >= max_per_sector:
                return
            sector_counts[sector_name] += 1

        # 날짜 파싱
        raw_date = item.get("pubDate", "")
        try:
            formatted_date = datetime.strptime(
                raw_date, "%a, %d %b %Y %H:%M:%S +0900"
            ).strftime("%Y-%m-%d %H:%M")
        except Exception:
            formatted_date = raw_date

        # 과장성 (TF-IDF, 빠름)
        clickbait_prob = proc.predict_clickbait(clean_title, full_text)

        # BERT 유형 분류 (블로킹 → 스레드풀)
        article_type, type_prob = "알 수 없음", 0.0
        if mm.bert_model:
            chunks = proc.clean_and_split(full_text)
            article_type, type_prob = await loop.run_in_executor(
                cpu_executor, proc.predict_type, chunks
            )

        # Groq 요약/감성 (비동기 + 속도 제한)
        async with groq_sem:
            await asyncio.sleep(0.3)
            groq_result = await groq.analyze(clean_title, full_text)

        news_obj = {
            "category":       sector_name,
            "title":          clean_title,
            "summary":        groq_result.get("summary",   "요약 없음"),
            "sentiment":      groq_result.get("sentiment", "중립"),
            "link":           link,
            "date":           formatted_date,
            "clickbait_prob": clickbait_prob,
            "article_type":   article_type,
            "type_prob":      type_prob
        }

        print(
            f"   ✅ [{formatted_date}] {clean_title[:20]}...\n"
            f"      감성: {news_obj['sentiment']} | "
            f"유형: {article_type}({type_prob:.1f}%) | "
            f"과장성: {clickbait_prob:.1f}%\n"
            f"      요약: {news_obj['summary']}\n"
        )

        await result_queue.put(news_obj)

    # ── 실행 ─────────────────────────────────────────────────────────
    try:
        connection = db.connect()
        cursor     = connection.cursor()
        print(f"✅ DB 연결 성공! (테이블: {db_table})")
    except Exception as e:
        print(f"❌ DB 연결 실패: {e}")
        return 0

    async with aiohttp.ClientSession() as session:
        # 전 섹터 네이버 API 동시 호출
        # ✅ 수정된 코드 (하나씩 0.5초 간격으로 순서대로 호출)
        sector_results = []
        for name, info in sector_config.items():
            result = await fetch_naver_items(name, info, session)
            sector_results.append(result)
            await asyncio.sleep(0.5)  # 다음 섹터 검색 전 0.5초 대기 (API 방어)
        # DB writer 시작
        writer_task = asyncio.create_task(db_writer(connection, cursor))

        # 전 섹터 기사 동시 처리
        all_tasks = []
        for sector_name, items in sector_results:
            info = sector_config[sector_name]
            print(f"\n📡 {sector_name} ({len(items)}개 후보)")
            for item in items:
                if "naver.com" in item.get("link", ""):
                    all_tasks.append(process_article(sector_name, info, item, session))

        await asyncio.gather(*all_tasks)

        # DB writer 종료
        await result_queue.put(None)
        success, duplicate = await writer_task

    cursor.close()
    connection.close()
    db_executor.shutdown(wait=False)
    cpu_executor.shutdown(wait=False)

    # httpx AsyncClient를 루프 종료 전에 명시적으로 닫아 'Event loop is closed' 경고 방지
    for client in groq._clients:
        try:
            await client.aclose()
        except Exception:
            pass

    total = sum(sector_counts.values())
    print(f"\n✅ [{db_table}] 완료 — 처리: {total}개 | 신규: {success}개 | 중복: {duplicate}개")
    return success
