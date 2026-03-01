import os
import io
import re
import json
import time
import uuid
import requests
import base64
import fitz  # PyMuPDF
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from anthropic import Anthropic
from agents import SessionState, handle_start, handle_interrupt, handle_resume, get_session_summary
from gemini_live import transcribe_audio as gemini_transcribe, live_respond
from rag import DocumentRAG
from podcast import generate_podcast_mp3

load_dotenv()

app = FastAPI()

# allow your Lovable frontend to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files with no-cache for JS (avoids stale zoom/state)
from starlette.middleware.base import BaseHTTPMiddleware

class NoCacheJS(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.endswith(".js"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

app.add_middleware(NoCacheJS)
app.mount("/static", StaticFiles(directory="static"), name="static")

# in-memory session store — one session per user for the hackathon
# (in production you'd use Redis or a database)
sessions: dict[str, SessionState] = {}
full_texts: dict[str, str] = {}
page_texts: dict[str, dict[int, str]] = {}  # session_id -> {page_num -> text}
rag_indexes: dict[str, DocumentRAG] = {}  # session_id -> RAG index for semantic retrieval
live_histories: dict[str, list] = {}  # session_id -> Gemini Live conversation history


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def pdf_to_sentences(pdf_bytes: bytes) -> tuple[list[str], str, dict]:
    """Parse PDF into individual sentences, full text, and page mapping"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    full_text = ""
    page_texts = {}  # page_num -> text content
    
    for page_num, page in enumerate(doc, start=1):
        page_text = page.get_text()
        page_texts[page_num] = page_text
        full_text += page_text

    # split into sentences (simple approach — good enough for hackathon)
    import re
    sentences = re.split(r'(?<=[.!?])\s+', full_text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 20]
    return sentences, full_text, page_texts


def generate_image(prompt: str) -> str | None:
    """Call Runware to generate a visual explainer"""
    try:
        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
            json=[{
                "taskType": "imageInference",
                "taskUUID": str(uuid.uuid4()),
                "positivePrompt": f"Clean educational diagram explaining: {prompt}. Minimal, clear, white background, infographic style.",
                "model": "runware:100@1",  # FLUX Schnell — fastest model
                "width": 512,
                "height": 512,
                "numberResults": 1,
            }]
        )
        data = response.json()
        if "data" in data and len(data["data"]) > 0:
            return data["data"][0].get("imageURL")
        return None
    except Exception as e:
        print(f"Runware error: {e}")
        return None


def generate_video(prompt: str, max_wait_seconds: int = 180, poll_interval: int = 3) -> str | None:
    """Call Runware to generate a short educational video. Uses async + polling."""
    try:
        task_uuid = str(uuid.uuid4())
        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
            json=[{
                "taskType": "videoInference",
                "taskUUID": task_uuid,
                "deliveryMethod": "async",
                "positivePrompt": f"Educational explainer video: {prompt}. Clear, professional, smooth motion, infographic style.",
                "model": "klingai:5@3",
                "duration": 5,
                "width": 1920,
                "height": 1080,
                "numberResults": 1,
            }]
        )
        data = response.json()
        if "errors" in data and len(data["errors"]) > 0:
            print(f"Runware video submit error: {data['errors']}")
            return None
        print(f"Runware video: submitted {task_uuid}, waiting 10s before first poll...")
        # Initial delay (video takes time to start); docs recommend this
        time.sleep(10)
        elapsed = 10
        while elapsed < max_wait_seconds:
            time.sleep(poll_interval)
            elapsed += poll_interval
            poll_resp = requests.post(
                "https://api.runware.ai/v1",
                headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
                json=[{"taskType": "getResponse", "taskUUID": task_uuid}]
            )
            poll_data = poll_resp.json()
            # Check errors array — failed tasks appear here
            if "errors" in poll_data and len(poll_data["errors"]) > 0:
                for err in poll_data["errors"]:
                    if err.get("taskUUID") == task_uuid:
                        print(f"Runware video failed: {err}")
                        return None
                print(f"Runware poll errors: {poll_data['errors']}")
            if "data" in poll_data and len(poll_data["data"]) > 0:
                item = poll_data["data"][0]
                status = item.get("status", "")
                print(f"Runware video: poll at {elapsed}s, status={status}")
                if status == "success":
                    return item.get("videoURL")
                if status == "error":
                    print(f"Runware video error: {item}")
                    return None
            else:
                print(f"Runware video: poll at {elapsed}s, no data yet (still processing)")
        print("Runware video: timeout waiting for result")
        return None
    except Exception as e:
        print(f"Runware video error: {e}")
        return None


# ElevenLabs voice IDs: Rachel (female host), Adam (male guest)
VOICE_RACHEL = "21m00Tcm4TlvDq8ikWAM"   # Calm, professional female
VOICE_ADAM = "pNInz6obpgDQGcFmaJgB"     # Deep, authoritative male


def text_to_speech(text: str, voice_id: str | None = None) -> bytes:
    """Convert text to audio using Runware (ElevenLabs). Optional voice_id for different voices."""
    try:
        speech = {"text": text}
        if voice_id:
            speech["voice"] = voice_id
        task_uuid = str(uuid.uuid4())
        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
            json=[{
                "taskType": "audioInference",
                "taskUUID": task_uuid,
                "model": "elevenlabs:24@1",  # Eleven Flash v2.5 - fast, natural speech
                "speech": speech,
                "outputType": "base64Data",
                "outputFormat": "MP3",  # Must be uppercase
                "numberResults": 1,
                "audioSettings": {
                    "sampleRate": 44100,
                    "bitrate": 192
                }
            }]
        )
        
        data = response.json()
        
        if "data" in data and len(data["data"]) > 0:
            audio_base64 = data["data"][0].get("audioBase64Data")
            if audio_base64:
                return base64.b64decode(audio_base64)
        
        # fallback: return empty audio if generation fails
        print(f"Runware TTS error: {data}")
        return b""
        
    except Exception as e:
        print(f"Runware TTS error: {e}")
        return b""


# ─────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────

@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...), session_id: str = "default"):
    """Upload a PDF and initialize the session"""
    pdf_bytes = await file.read()
    sentences, full_text, page_text_map = pdf_to_sentences(pdf_bytes)

    sessions[session_id] = SessionState(sentences)
    full_texts[session_id] = full_text
    page_texts[session_id] = page_text_map

    # Build RAG index for semantic retrieval
    try:
        rag = DocumentRAG()
        rag.index(sentences, page_text_map)
        rag_indexes[session_id] = rag
    except Exception as e:
        print(f"RAG index build failed (will use positional context): {e}")
        rag_indexes[session_id] = None

    return {
        "success": True,
        "sentence_count": len(sentences),
        "preview": sentences[:3]  # first 3 sentences as preview
    }


@app.post("/start")
async def start_reading(session_id: str = "default"):
    """Start or resume reading — returns next sentence + audio"""
    state = sessions.get(session_id)
    if not state:
        return {"error": "No session found. Upload a PDF first."}

    result = handle_start(state)

    if result.get("done"):
        return {"done": True, "message": "Paper complete!"}

    # generate audio for the sentence
    audio = text_to_speech(result["sentence"])

    return {
        "sentence": result["sentence"],
        "position": state.position,
        "proactive_flag": result.get("proactive_flag", False),
        "flag_message": result.get("flag_message"),
        "audio_b64": audio.hex()  # send as hex, frontend converts to audio
    }


class InterruptRequest(BaseModel):
    question: str
    session_id: str = "default"
    response_types: list[str] = ["text", "voice"]  # text, voice, image, video

@app.post("/interrupt")
async def interrupt(req: InterruptRequest):
    """User interrupted — answer their question + generate multimodal response"""
    state = sessions.get(req.session_id)
    full_text = full_texts.get(req.session_id, "")
    page_text_map = page_texts.get(req.session_id, {})

    if not state:
        return {"error": "No session found"}

    rag = rag_indexes.get(req.session_id)
    rag_retriever = rag.retrieve if rag else None

    result = handle_interrupt(req.question, state, full_text, rag_retriever=rag_retriever)

    # Sources come from RAG retrieval (chunk text + page) — no model prompting needed
    sources_with_pages = []
    if result.get("retrieved_chunks"):
        for chunk_text, page_num in result["retrieved_chunks"][:5]:
            excerpt = (chunk_text[:150] + "…") if len(chunk_text) > 150 else chunk_text
            sources_with_pages.append({"text": excerpt.strip(), "page": page_num})

    embedding_backend = rag.get_embedding_backend() if rag and hasattr(rag, 'get_embedding_backend') else "none"
    print(f"📚 RAG pathway: {embedding_backend}")

    response = {
        "resume_position": result["reading_position"],
        "summary": get_session_summary(state),
        "sources": sources_with_pages,
        "embedding_backend": embedding_backend,
    }

    # Generate requested response types
    if "text" in req.response_types:
        response["answer"] = result["answer"]
    
    if "voice" in req.response_types:
        audio = text_to_speech(result["answer"])
        response["audio_b64"] = audio.hex() if audio else None
    
    if "image" in req.response_types:
        prompt = result.get("visual_prompt") or result["answer"] or req.question[:200]
        image_url = generate_image(prompt)
        response["image_url"] = image_url
    
    if "video" in req.response_types:
        prompt = result.get("visual_prompt") or result["answer"] or req.question[:200]
        video_url = generate_video(prompt)
        response["video_url"] = video_url

    return response


class QuizSelectionRequest(BaseModel):
    selected_text: str
    session_id: str = "default"


@app.post("/quiz-selection")
async def quiz_selection(req: QuizSelectionRequest):
    """Generate 3 multiple-choice quiz questions from selected PDF text."""
    text = req.selected_text.strip()
    if not text or len(text) < 20:
        return JSONResponse(status_code=400, content={"error": "Select more text to generate a quiz"})
    if len(text) > 3000:
        text = text[:3000] + "..."

    prompt = f"""You are a quiz generator. Given the following excerpt from an academic paper, generate exactly 3 multiple-choice questions to test understanding of the key ideas.

Excerpt:
\"\"\"
{text}
\"\"\"

Return ONLY a valid JSON object in this exact format (no markdown, no explanation):
{{
  "questions": [
    {{
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "explanation": "Brief explanation of why the answer is correct."
    }}
  ]
}}

Rules:
- "correct" is the 0-based index of the correct option
- All 4 options must be plausible but only one correct
- Questions should test genuine understanding, not trivial recall
- Keep questions concise and clear"""

    try:
        anthropic_client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        message = anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        raw = raw.replace("```json", "").replace("```", "").strip()
        data = json.loads(raw)
        return data
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Quiz generation failed: {str(e)}"})


class ExplainSelectionRequest(BaseModel):
    selected_text: str
    explain_type: str  # "text", "audio", "image", "video"
    session_id: str = "default"


@app.post("/explain-selection")
async def explain_selection(req: ExplainSelectionRequest):
    """Explain selected PDF text via text, audio, image, or video (Nemotron + Runware)."""
    state = sessions.get(req.session_id)
    full_text = full_texts.get(req.session_id, "")
    if not state:
        return JSONResponse(status_code=400, content={"error": "No session found"})
    text = req.selected_text.strip()
    if not text or len(text) < 5:
        return JSONResponse(status_code=400, content={"error": "Select more text to explain"})
    if len(text) > 2000:
        text = text[:2000] + "..."

    question = f"Explain this excerpt from the paper in simple, clear terms: \"{text}\""
    rag = rag_indexes.get(req.session_id)
    rag_retriever = rag.retrieve if rag else None
    result = handle_interrupt(question, state, full_text, rag_retriever=rag_retriever)

    out = {
        "answer": result["answer"],
        "embedding_backend": rag.get_embedding_backend() if rag and hasattr(rag, "get_embedding_backend") else "none",
    }
    if req.explain_type == "audio":
        audio = text_to_speech(result["answer"])
        out["audio_base64"] = audio.hex() if audio else None
    elif req.explain_type == "image":
        prompt = result.get("visual_prompt") or result["answer"] or text[:200]
        img_url = generate_image(prompt)
        out["image_url"] = img_url
    elif req.explain_type == "video":
        prompt = result.get("visual_prompt") or result["answer"] or text[:200]
        video_url = generate_video(prompt)
        out["video_url"] = video_url
    return out


class ExportPodcastRequest(BaseModel):
    session_id: str = "default"
    length: str = "medium"  # "short" or "medium"


@app.post("/export-podcast")
async def export_podcast(req: ExportPodcastRequest):
    """Generate a podcast (MP3) from the uploaded paper. Can take 1–3 minutes."""
    print("Podcast: Request received...")
    full_text = full_texts.get(req.session_id, "")
    if not full_text:
        return JSONResponse(
            status_code=400,
            content={"error": "No document found. Upload a PDF first."},
        )

    try:
        mp3_bytes, transcript = generate_podcast_mp3(
            full_text, length=req.length, tts_func=text_to_speech
        )
        return {
            "audio_base64": base64.b64encode(mp3_bytes).decode(),
            "transcript": transcript,
        }
    except Exception as e:
        print(f"Podcast export error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


def _generate_video_overview_prompt(full_text: str) -> str:
    """Use Claude to create a short video prompt summarizing the paper."""
    text = full_text[:16_000] + ("..." if len(full_text) > 16_000 else "")
    client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        system="""You create short prompts for AI video generation. Given a research paper summary, output 2-3 sentences describing a visual overview: key concept, main finding, or central idea. Describe what to SHOW (diagrams, animations, concepts). Be concrete. No narration text—just visual description. Output ONLY the prompt, nothing else.""",
        messages=[{"role": "user", "content": text}],
        temperature=0.5,
    )
    return response.content[0].text.strip()[:500]


class ExportVideoOverviewRequest(BaseModel):
    session_id: str = "default"


@app.post("/export-video-overview")
async def export_video_overview(req: ExportVideoOverviewRequest):
    """Generate a 5-second video overview of the paper. Takes 2–4 minutes."""
    print("Video overview: Request received...")
    full_text = full_texts.get(req.session_id, "")
    if not full_text:
        return JSONResponse(
            status_code=400,
            content={"error": "No document found. Upload a PDF first."},
        )

    try:
        prompt = _generate_video_overview_prompt(full_text)
        print(f"Video overview: Prompt: {prompt[:80]}...")
        video_url = generate_video(prompt, max_wait_seconds=300)
        if not video_url:
            return JSONResponse(status_code=500, content={"error": "Video generation failed"})
        return {"video_url": video_url}
    except Exception as e:
        print(f"Video overview error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/resume")
async def resume_reading(session_id: str = "default"):
    """User said 'continue' — resume from exact position"""
    state = sessions.get(session_id)
    if not state:
        return {"error": "No session found"}

    result = handle_resume(state)

    if result.get("done"):
        return {"done": True}

    audio = text_to_speech(result["sentence"])

    return {
        "sentence": result["sentence"],
        "position": state.position,
        "audio_b64": audio.hex(),
        "summary": get_session_summary(state)
    }


@app.get("/summary/{session_id}")
async def get_summary(session_id: str = "default"):
    """Returns the memory panel data"""
    state = sessions.get(session_id)
    if not state:
        return {"error": "No session found"}
    return get_session_summary(state)


@app.get("/")
async def root():
    """Serve the chat frontend"""
    return FileResponse("static/index_chat.html")


@app.get("/api")
async def api_info():
    """API information endpoint"""
    return {
        "name": "PaperMind API",
        "description": "AI-powered reading assistant for people with ADHD",
        "version": "1.0.0",
        "endpoints": {
            "POST /upload": "Upload a PDF and initialize session",
            "POST /start": "Start reading (returns sentence + audio)",
            "POST /interrupt": "Interrupt with a question",
            "POST /resume": "Resume reading after interruption",
            "GET /summary/{session_id}": "Get session summary",
            "GET /health": "Health check",
            "GET /docs": "Interactive API documentation"
        },
        "docs_url": "/docs"
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Gemini Live Talk ───────────────────────────────────────────────────────────

class LiveTalkRequest(BaseModel):
    session_id: str = "default"
    audio_base64: str  # WebM audio blob from browser, base64-encoded


@app.post("/live/talk")
async def live_talk(req: LiveTalkRequest):
    """
    One turn of live voice conversation about the loaded paper.
    1. Transcribes the user's audio with Gemini Flash
    2. Retrieves relevant RAG context from the paper
    3. Sends message + injected history to Gemini Live
    4. Returns WAV audio + transcripts for both sides
    """
    state = sessions.get(req.session_id)
    rag = rag_indexes.get(req.session_id)

    audio_bytes = base64.b64decode(req.audio_base64)

    # 1. Transcribe
    transcript = await gemini_transcribe(audio_bytes)
    if not transcript:
        return JSONResponse(status_code=400, content={"error": "Could not understand audio. Please try again."})

    # 2. Retrieve relevant paper context via RAG
    context = ""
    if rag and transcript:
        try:
            chunks = rag.retrieve(transcript, top_k=3)
            if chunks:
                context = "\n\n".join([
                    f'"{text.strip()}" [p.{page}]' for text, page in chunks
                ])
        except Exception as e:
            print(f"[live_talk] RAG error: {e}")

    if not context and state:
        context = state.surrounding_context(window=5)

    # 3. Build system prompt with paper context + reading state
    knowledge_gaps = getattr(state, "knowledge_gaps", []) if state else []
    position_info = (
        f"Reading position: sentence {state.position} of {len(state.sentences)}"
        if state else ""
    )

    system_prompt = f"""You are PaperMind, a warm and concise AI tutor helping someone with ADHD understand a research paper through natural voice conversation.

RELEVANT PAPER CONTEXT:
{context or "No document loaded yet — you can still chat generally."}

{position_info}
{("Known knowledge gaps for this user: " + ", ".join(knowledge_gaps)) if knowledge_gaps else ""}

Guidelines:
- Be conversational and warm — this is a spoken dialogue, not a written response
- Keep answers brief (2-3 sentences) unless the user asks for more detail
- Ask a short follow-up question to check understanding when appropriate
- Reference specific parts of the paper when helpful
- Do NOT end with "Ready to continue?" — this is a free conversation mode"""

    # 4. Get conversation history
    history = live_histories.get(req.session_id, [])

    # 5. Call Gemini Live
    wav_bytes, response_text = await live_respond(transcript, system_prompt, history)

    # 6. Update history
    history = history + [{"role": "user", "text": transcript}]
    if response_text:
        history = history + [{"role": "model", "text": response_text}]
    live_histories[req.session_id] = history[-20:]  # keep last 10 turns

    return {
        "user_transcript": transcript,
        "response_transcript": response_text,
        "audio_base64": base64.b64encode(wav_bytes).decode() if wav_bytes else None,
    }


class LiveResetRequest(BaseModel):
    session_id: str = "default"


@app.post("/live/reset")
async def live_reset(req: LiveResetRequest):
    """Clear the live conversation history for a session."""
    live_histories.pop(req.session_id, None)
    return {"status": "ok"}


class TTSRequest(BaseModel):
    text: str
    session_id: str = "default"


@app.post("/tts")
async def tts_endpoint(req: TTSRequest):
    """Convert arbitrary text to speech (for read-aloud on chat messages)."""
    text = req.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "No text provided"})
    if len(text) > 4000:
        text = text[:4000]
    audio_bytes = text_to_speech(text)
    if not audio_bytes:
        return JSONResponse(status_code=500, content={"error": "TTS generation failed"})
    return {"audio_base64": base64.b64encode(audio_bytes).decode()}