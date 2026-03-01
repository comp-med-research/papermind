import os
import io
import re
import json
import time
import uuid
import asyncio
import threading
import queue as stdlib_queue
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
from agents import (
    SessionState, handle_start, handle_interrupt, handle_resume, get_session_summary,
    nemotron, prepare_conversation_context, claude_judge_knowledge_gap,
)
from gemini_live import live_respond_from_audio, live_respond
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


def claude_image_prompt(explanation: str, selected_text: str) -> str:
    """
    Ask Claude to turn a Nemotron explanation into a focused Runware image-generation
    prompt. Returns the prompt string (falls back to a simple truncated version).
    """
    try:
        client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=120,
            system=(
                "You write short, precise image-generation prompts for an AI image model (Runware/FLUX). "
                "Given a scientific explanation, output ONLY the image prompt — no preamble, no quotes. "
                "The prompt should describe a clear educational diagram or infographic that visually "
                "represents the core concept. Specify style (e.g. 'flat vector diagram', 'infographic', "
                "'scientific illustration'), key visual elements, and white or light background. "
                "Keep it under 80 words. Do NOT include any text labels or speech bubbles in the description."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"Selected text from paper: \"{selected_text[:300]}\"\n\n"
                    f"Explanation: {explanation[:600]}\n\n"
                    "Write the Runware image prompt:"
                ),
            }],
        )
        return response.content[0].text.strip()
    except Exception as e:
        print(f"claude_image_prompt error: {e}")
        return explanation[:200]


def claude_video_scenes(explanation: str, selected_text: str) -> dict:
    """
    Ask Claude to produce two things from a Nemotron explanation:
      1. keyframe_prompt  — image prompt for a styled reference keyframe
      2. video_prompt     — multi-shot video prompt with explicit "Shot N:" markers
    Returns {"keyframe_prompt": str, "video_prompt": str}.
    Falls back to truncated text on any error.
    """
    try:
        client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=450,
            system=(
                "You create prompts for AI video generation (Runware / KlingAI multi-shot). "
                "Given a scientific explanation, output valid JSON with exactly two keys:\n\n"
                "\"keyframe_prompt\": A single image-generation prompt (≤60 words) describing a clean "
                "educational diagram that sets the visual style. Specify: flat vector infographic style, "
                "white background, a consistent color palette (e.g. blue/teal/white), and the central "
                "concept as a simple diagram. No text or labels in the image.\n\n"
                "\"video_prompt\": A multi-shot video prompt (≤180 words) with 3-4 sequential scenes "
                "prefixed 'Shot 1:', 'Shot 2:', etc. Each shot shows one distinct visual idea from the "
                "explanation — diagrams assembling, arrows flowing, components animating. Use the same "
                "infographic style throughout. End with a wide shot showing the full concept. "
                "Describe motion, not static images (e.g. 'arrows slide in', 'box expands', 'diagram "
                "assembles piece by piece'). No narration text or subtitles.\n\n"
                "Output ONLY the JSON object. No markdown fences, no extra keys."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"Selected text from paper: \"{selected_text[:300]}\"\n\n"
                    f"Explanation: {explanation[:700]}\n\n"
                    "Output JSON:"
                ),
            }],
        )
        import json as _json
        raw = response.content[0].text.strip()
        result = _json.loads(raw)
        return {
            "keyframe_prompt": str(result.get("keyframe_prompt", explanation[:150])),
            "video_prompt":    str(result.get("video_prompt",    explanation[:200])),
        }
    except Exception as e:
        print(f"claude_video_scenes error: {e}")
        return {
            "keyframe_prompt": explanation[:150],
            "video_prompt":    explanation[:200],
        }


def generate_educational_video(
    explanation: str,
    selected_text: str,
    max_wait_seconds: int = 180,
) -> str | None:
    """
    Full educational video pipeline:
      1. Claude breaks the explanation into a keyframe prompt + multi-shot video prompt.
      2. Generate a keyframe image for display alongside the video.
      3. Submit a Wan text-to-video job with:
           - multi-shot mode (providerSettings.alibaba.shotType = "multi")
           - promptExtend = true (LLM-based prompt rewriting for coherence)
      4. Poll until complete and return the video URL.
    Note: alibaba:wan@2.6 does not support frameImages (image-to-video); the
    keyframe is shown in the UI as a visual reference only.
    """
    # Step 1 — Claude scene breakdown
    scenes = claude_video_scenes(explanation, selected_text)
    print(f"🎬 Keyframe prompt: {scenes['keyframe_prompt'][:100]}")
    print(f"🎬 Video prompt:    {scenes['video_prompt'][:120]}")

    # Step 2 — Generate reference keyframe image
    keyframe_url = generate_image(scenes["keyframe_prompt"])
    if not keyframe_url:
        print("🎬 Keyframe generation failed — falling back to text-only video")

    # Step 3 — Submit video job
    task_uuid = str(uuid.uuid4())
    payload: dict = {
        "taskType": "videoInference",
        "taskUUID": task_uuid,
        "deliveryMethod": "async",
        # alibaba:wan supports providerSettings.alibaba (promptExtend + shotType).
        # klingai models do NOT accept alibaba providerSettings — use Wan here.
        "model": "alibaba:wan@2.6",
        "positivePrompt": scenes["video_prompt"],
        "negativePrompt": (
            "blurry, low quality, distorted, flickering, jitter, photorealistic, "
            "live action, people, faces, watermark, text overlay, subtitles"
        ),
        "duration": 10,
        "width": 1280,
        "height": 720,
        "numberResults": 1,
        "providerSettings": {
            "alibaba": {
                "promptExtend": True,  # LLM expands/rewrites prompt for coherence
                "shotType": "multi",   # multi-shot with scene transitions
            }
        },
    }
    # frameImages (image-to-video) is not supported by alibaba:wan@2.6;
    # keyframe is shown in the UI only.

    try:
        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
            json=[payload],
        )
        data = response.json()
        if "errors" in data and data["errors"]:
            print(f"🎬 Video submit error: {data['errors']}")
            return None
    except Exception as e:
        print(f"🎬 Video submit exception: {e}")
        return None

    # Step 4 — Poll for result
    return _poll_video(task_uuid, max_wait_seconds)


def _poll_video(task_uuid: str, max_wait_seconds: int = 180, poll_interval: int = 3) -> str | None:
    """Poll Runware getResponse until the video task completes or times out."""
    print(f"🎬 Submitted {task_uuid}, waiting 10 s before first poll…")
    time.sleep(10)
    elapsed = 10
    while elapsed < max_wait_seconds:
        time.sleep(poll_interval)
        elapsed += poll_interval
        try:
            poll_resp = requests.post(
                "https://api.runware.ai/v1",
                headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
                json=[{"taskType": "getResponse", "taskUUID": task_uuid}],
            )
            poll_data = poll_resp.json()
        except Exception as e:
            print(f"🎬 Poll exception: {e}")
            continue

        if "errors" in poll_data and poll_data["errors"]:
            for err in poll_data["errors"]:
                if err.get("taskUUID") == task_uuid:
                    print(f"🎬 Video failed: {err}")
                    return None
        if "data" in poll_data and poll_data["data"]:
            item = poll_data["data"][0]
            status = item.get("status", "")
            print(f"🎬 Poll at {elapsed}s — status: {status}")
            if status == "success":
                return item.get("videoURL")
            if status == "error":
                print(f"🎬 Video error item: {item}")
                return None
        else:
            print(f"🎬 Poll at {elapsed}s — still processing")
    print("🎬 Timeout waiting for video")
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
        video_url = generate_educational_video(
            explanation=result["answer"],
            selected_text=req.question,
        )
        response["video_url"] = video_url

    return response


@app.post("/interrupt/stream")
async def interrupt_stream(req: InterruptRequest):
    """
    Streaming version of /interrupt — returns an SSE stream of text deltas,
    then a final 'done' event with sources / metadata.
    Only streams text; image generation (if requested) is appended in the done event.
    """
    state = sessions.get(req.session_id)
    if not state:
        async def _err():
            yield f"data: {json.dumps({'error': 'No session found. Upload a PDF first.'})}\n\n"
        return StreamingResponse(_err(), media_type="text/event-stream")

    full_text = full_texts.get(req.session_id, "")
    rag = rag_indexes.get(req.session_id)
    rag_retriever = rag.retrieve if rag else None

    state.status = "INTERRUPTED"

    # RAG retrieval + prompt building runs synchronously before streaming begins
    messages, retrieved_chunks = prepare_conversation_context(
        req.question, state, rag_retriever
    )
    model = os.getenv("NEMOTRON_CONVERSATION_MODEL", os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3-nano"))

    async def generate():
        chunk_queue: stdlib_queue.Queue = stdlib_queue.Queue()

        def _stream_nemotron():
            """Runs the blocking Nemotron stream in a background thread."""
            try:
                stream = nemotron.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=400,
                    temperature=0.4,
                    stream=True,
                )
                accumulated = ""
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        accumulated += delta
                        chunk_queue.put(("text", delta))
                chunk_queue.put(("done", accumulated))
            except Exception as exc:
                chunk_queue.put(("error", str(exc)))

        threading.Thread(target=_stream_nemotron, daemon=True).start()

        full_answer = ""
        final_type = None
        final_data = None

        # Process one chunk at a time, yielding event-loop control after each
        # so HTTP chunks are actually flushed to the client progressively.
        while final_type is None:
            try:
                type_, data = chunk_queue.get_nowait()
            except stdlib_queue.Empty:
                await asyncio.sleep(0.01)  # brief pause when queue is empty
                continue

            if type_ == "text":
                full_answer += data
                yield f"data: {json.dumps({'text': data})}\n\n"
                await asyncio.sleep(0)  # release event loop so the chunk is flushed
            else:
                final_type = type_
                final_data = data

        if final_type == "error":
            yield f"data: {json.dumps({'error': final_data})}\n\n"
            return

        # Clean VISUAL prompt from the streamed answer
        visual_prompt = None
        answer = full_answer
        if "VISUAL:" in answer:
            parts = answer.split("VISUAL:")
            answer = parts[0].strip()
            visual_prompt = parts[1].strip()
        answer = answer.strip()

        # Update session state
        state.questions_asked.append({
            "question": req.question,
            "answer": answer,
            "position": state.position,
            "sources": [t for t, _ in retrieved_chunks],
        })
        state.status = "ANSWERING"

        gap = claude_judge_knowledge_gap(req.question, state)
        if gap and gap not in state.knowledge_gaps:
            state.knowledge_gaps.append(gap)

        # Build sources list
        sources_with_pages = []
        for chunk_text, page_num in retrieved_chunks[:5]:
            excerpt = (chunk_text[:150] + "…") if len(chunk_text) > 150 else chunk_text
            sources_with_pages.append({"text": excerpt.strip(), "page": page_num})

        embedding_backend = (
            rag.get_embedding_backend() if rag and hasattr(rag, "get_embedding_backend") else "none"
        )
        print(f"📚 RAG pathway (stream): {embedding_backend}")

        # Generate image/video if requested (non-streaming, appended to done event)
        image_url = None
        if "image" in req.response_types:
            prompt = visual_prompt or answer[:200]
            image_url = generate_image(prompt)

        video_url = None
        if "video" in req.response_types:
            video_url = generate_educational_video(
                explanation=answer,
                selected_text=req.question,
            )

        yield f"data: {json.dumps({'done': True, 'sources': sources_with_pages, 'embedding_backend': embedding_backend, 'image_url': image_url, 'video_url': video_url, 'resume_position': state.position})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


@app.post("/explain-selection/stream")
async def explain_selection_stream(req: ExplainSelectionRequest):
    """
    Streaming version of /explain-selection.
    Streams text tokens via SSE, then emits a 'done' event that includes
    audio_base64 (audio type) or image_url (image type).
    Video is not streamed — use the regular /explain-selection endpoint.
    """
    sess = sessions.get(req.session_id)
    # Session may be absent if the server restarted after upload (in-memory store).
    # For explain-selection we only need RAG context, so a minimal fallback is fine.
    if not sess:
        full_text_check = full_texts.get(req.session_id, "")
        if not full_text_check:
            async def _err():
                yield f"data: {json.dumps({'error': 'No document found. Upload a PDF first.'})}\n\n"
            return StreamingResponse(_err(), media_type="text/event-stream")
        sess = SessionState([])  # minimal state — no conversation history

    text = req.selected_text.strip()
    if not text or len(text) < 5:
        async def _err():
            yield f"data: {json.dumps({'error': 'Select more text to explain'})}\n\n"
        return StreamingResponse(_err(), media_type="text/event-stream")
    if len(text) > 2000:
        text = text[:2000] + "..."

    question = f"Explain this excerpt from the paper in simple, clear terms: \"{text}\""
    rag = rag_indexes.get(req.session_id)
    rag_retriever = rag.retrieve if rag else None
    messages, _ = prepare_conversation_context(question, sess, rag_retriever)
    model = os.getenv("NEMOTRON_CONVERSATION_MODEL", os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3-nano"))

    async def generate():
        chunk_queue: stdlib_queue.Queue = stdlib_queue.Queue()

        def _stream():
            try:
                stream = nemotron.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=400,
                    temperature=0.4,
                    stream=True,
                )
                accumulated = ""
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        accumulated += delta
                        chunk_queue.put(("text", delta))
                chunk_queue.put(("done", accumulated))
            except Exception as exc:
                chunk_queue.put(("error", str(exc)))

        threading.Thread(target=_stream, daemon=True).start()

        full_answer = ""
        final_type = final_data = None

        while final_type is None:
            try:
                final_type, final_data = chunk_queue.get_nowait()
            except stdlib_queue.Empty:
                await asyncio.sleep(0.01)
                continue
            if final_type == "text":
                full_answer += final_data
                yield f"data: {json.dumps({'text': final_data})}\n\n"
                await asyncio.sleep(0)
                final_type = None  # keep looping

        if final_type == "error":
            yield f"data: {json.dumps({'error': final_data})}\n\n"
            return

        answer = full_answer.strip()
        embedding_backend = (
            rag.get_embedding_backend() if rag and hasattr(rag, "get_embedding_backend") else "none"
        )
        done_payload: dict = {"done": True, "embedding_backend": embedding_backend}

        if req.explain_type == "audio":
            audio = text_to_speech(answer)
            done_payload["audio_base64"] = base64.b64encode(audio).decode() if audio else None
        elif req.explain_type == "image":
            img_prompt = claude_image_prompt(answer, req.selected_text)
            print(f"🎨 Image prompt (Claude): {img_prompt[:120]}")
            done_payload["image_url"] = generate_image(img_prompt)

        yield f"data: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/explain-selection")
async def explain_selection(req: ExplainSelectionRequest):
    """Explain selected PDF text via text, audio, image, or video (Nemotron + Runware)."""
    state = sessions.get(req.session_id)
    full_text = full_texts.get(req.session_id, "")
    if not state:
        if not full_text:
            return JSONResponse(status_code=400, content={"error": "No document found. Upload a PDF first."})
        state = SessionState([])  # minimal fallback — RAG context still available
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
        out["audio_base64"] = base64.b64encode(audio).decode() if audio else None
    elif req.explain_type == "image":
        img_prompt = claude_image_prompt(result["answer"], text)
        print(f"🎨 Image prompt (Claude): {img_prompt[:120]}")
        img_url = generate_image(img_prompt)
        out["image_url"] = img_url
    elif req.explain_type == "video":
        video_url = generate_educational_video(result["answer"], text)
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


def _generate_video_overview_prompt(full_text: str) -> dict:
    """
    Use Claude to produce a keyframe image prompt + multi-shot video prompt
    that summarises the whole paper visually.
    Returns {"keyframe_prompt": str, "video_prompt": str}.
    """
    text = full_text[:16_000] + ("..." if len(full_text) > 16_000 else "")
    try:
        client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            system=(
                "You create prompts for AI video generation (Runware / KlingAI multi-shot). "
                "Given a research paper, output valid JSON with exactly two keys:\n\n"
                "\"keyframe_prompt\": A single image-generation prompt (≤60 words) for a clean "
                "educational diagram that captures the paper's core contribution. Flat vector "
                "infographic style, white background, consistent blue/teal color palette. No text labels.\n\n"
                "\"video_prompt\": A multi-shot video prompt (≤200 words) with 4 sequential scenes "
                "prefixed 'Shot 1:', 'Shot 2:', 'Shot 3:', 'Shot 4:'. Cover: problem motivation, "
                "proposed method/architecture, key results, and broader impact. Each shot shows one "
                "visual idea animating (diagrams assembling, arrows flowing, charts building). "
                "Same infographic style throughout. No narration text or subtitles.\n\n"
                "Output ONLY the JSON object. No markdown fences."
            ),
            messages=[{"role": "user", "content": f"Research paper:\n\n{text}\n\nOutput JSON:"}],
        )
        import json as _json
        result = _json.loads(response.content[0].text.strip())
        return {
            "keyframe_prompt": str(result.get("keyframe_prompt", text[:150])),
            "video_prompt":    str(result.get("video_prompt",    text[:200])),
        }
    except Exception as e:
        print(f"_generate_video_overview_prompt error: {e}")
        return {
            "keyframe_prompt": full_text[:150],
            "video_prompt":    full_text[:200],
        }


class ExportVideoOverviewRequest(BaseModel):
    session_id: str = "default"


@app.post("/export-video-overview")
async def export_video_overview(req: ExportVideoOverviewRequest):
    """Generate a 10-second multi-shot video overview of the paper. Takes 2–4 minutes."""
    print("Video overview: Request received...")
    full_text = full_texts.get(req.session_id, "")
    if not full_text:
        return JSONResponse(
            status_code=400,
            content={"error": "No document found. Upload a PDF first."},
        )

    try:
        scenes = _generate_video_overview_prompt(full_text)
        print(f"🎬 Overview keyframe: {scenes['keyframe_prompt'][:80]}…")
        print(f"🎬 Overview video:    {scenes['video_prompt'][:100]}…")

        # Keyframe image anchors the visual style for the whole video
        keyframe_url = generate_image(scenes["keyframe_prompt"])
        print(f"🎬 Keyframe URL: {keyframe_url}")

        task_uuid = str(uuid.uuid4())
        payload: dict = {
            "taskType": "videoInference",
            "taskUUID": task_uuid,
            "deliveryMethod": "async",
            "model": "alibaba:wan@2.6",
            "positivePrompt": scenes["video_prompt"],
            "negativePrompt": (
                "blurry, low quality, distorted, flickering, jitter, photorealistic, "
                "live action, people, faces, watermark, text overlay, subtitles"
            ),
            "duration": 10,
            "width": 1280,
            "height": 720,
            "numberResults": 1,
            "providerSettings": {
                "alibaba": {
                    "promptExtend": True,
                    "shotType": "multi",
                }
            },
        }
        # frameImages not supported by alibaba:wan@2.6 — keyframe shown in UI only.

        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
            json=[payload],
        )
        data = response.json()
        if "errors" in data and data["errors"]:
            print(f"🎬 Overview submit error: {data['errors']}")
            return JSONResponse(status_code=500, content={"error": "Video submission failed"})

        video_url = _poll_video(task_uuid, max_wait_seconds=300)
        if not video_url:
            return JSONResponse(status_code=500, content={"error": "Video generation failed or timed out"})
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
    Audio is sent directly to Gemini Live — no separate transcription step.
    Gemini transcribes the user's speech internally, which saves ~1-2 s per turn.
    """
    state = sessions.get(req.session_id)
    rag = rag_indexes.get(req.session_id)
    history = live_histories.get(req.session_id, [])

    audio_bytes = base64.b64decode(req.audio_base64)

    # Build paper context using the previous turn's user message for RAG
    # (we don't have the current transcript yet — it comes back from Gemini).
    # This keeps latency low while still providing relevant context.
    context = ""
    retrieved_chunks: list = []
    last_user_msg = next((h["text"] for h in reversed(history) if h["role"] == "user"), None)
    if rag and last_user_msg:
        try:
            chunks = rag.retrieve(last_user_msg, top_k=3)
            if chunks:
                retrieved_chunks = chunks
                context = "\n\n".join([
                    f'"{text.strip()}" [p.{page}]' for text, page in chunks
                ])
        except Exception as e:
            print(f"[live_talk] RAG error: {e}")

    if not context and state:
        context = state.surrounding_context(window=8)

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

    # Single Gemini Live call — handles transcription + response in one round-trip
    wav_bytes, user_transcript, response_text = await live_respond_from_audio(
        audio_bytes, system_prompt, history
    )

    if not wav_bytes or len(wav_bytes) < 100:
        return JSONResponse(status_code=400, content={"error": "No response from Gemini. Please try again."})

    # Update conversation history
    display_transcript = user_transcript or "[voice]"
    history = history + [{"role": "user", "text": display_transcript}]
    if response_text:
        history = history + [{"role": "model", "text": response_text}]
    live_histories[req.session_id] = history[-20:]

    sources_with_pages = []
    for chunk_text, page_num in retrieved_chunks[:3]:
        excerpt = (chunk_text[:150] + "…") if len(chunk_text) > 150 else chunk_text
        sources_with_pages.append({"text": excerpt.strip(), "page": page_num})

    return {
        "user_transcript": user_transcript or None,
        "response_transcript": response_text,
        "audio_base64": base64.b64encode(wav_bytes).decode(),
        "sources": sources_with_pages,
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