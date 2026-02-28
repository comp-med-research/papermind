import os
import io
import uuid
import requests
import base64
import fitz  # PyMuPDF
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from agents import SessionState, handle_start, handle_interrupt, handle_resume, get_session_summary

load_dotenv()

app = FastAPI()

# allow your Lovable frontend to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# in-memory session store — one session per user for the hackathon
# (in production you'd use Redis or a database)
sessions: dict[str, SessionState] = {}
full_texts: dict[str, str] = {}
page_texts: dict[str, dict[int, str]] = {}  # session_id -> {page_num -> text}


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
                "taskUUID": "unique-task-id",
                "positivePrompt": f"Clean educational diagram explaining: {prompt}. Minimal, clear, white background, infographic style.",
                "model": "runware:100@1",  # FLUX Schnell — fastest model
                "width": 512,
                "height": 512,
                "numberResults": 1,
            }]
        )
        data = response.json()
        return data[0].get("imageURL")
    except Exception as e:
        print(f"Runware error: {e}")
        return None


def find_source_pages(sources: list[str], page_text_map: dict[int, str]) -> list[dict]:
    """Find which page each source quote appears on"""
    sources_with_pages = []
    
    for source in sources:
        # Clean the source text for matching
        source_clean = source.strip().lower()
        found_page = None
        
        # Search through pages
        for page_num, page_text in page_text_map.items():
            page_text_clean = page_text.lower()
            if source_clean in page_text_clean:
                found_page = page_num
                break
        
        sources_with_pages.append({
            "text": source,
            "page": found_page
        })
    
    return sources_with_pages


def text_to_speech(text: str) -> bytes:
    """Convert text to audio using Runware (ElevenLabs)"""
    try:
        task_uuid = str(uuid.uuid4())
        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {os.getenv('RUNWARE_API_KEY')}"},
            json=[{
                "taskType": "audioInference",
                "taskUUID": task_uuid,
                "model": "elevenlabs:24@1",  # Eleven Flash v2.5 - fast, natural speech
                "speech": {
                    "text": text
                },
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

    result = handle_interrupt(req.question, state, full_text)

    # Find page numbers for sources
    sources_with_pages = []
    if result.get("sources"):
        sources_with_pages = find_source_pages(result["sources"], page_text_map)

    response = {
        "resume_position": result["reading_position"],
        "summary": get_session_summary(state),
        "sources": sources_with_pages  # Include sources with page numbers
    }

    # Generate requested response types
    if "text" in req.response_types:
        response["answer"] = result["answer"]
    
    if "voice" in req.response_types:
        audio = text_to_speech(result["answer"])
        response["audio_b64"] = audio.hex() if audio else None
    
    if "image" in req.response_types and result.get("visual_prompt"):
        image_url = generate_image(result["visual_prompt"])
        response["image_url"] = image_url
    
    if "video" in req.response_types and result.get("visual_prompt"):
        # For now, video generation is not implemented
        # Could use Runware's video generation API in the future
        response["video_url"] = None

    return response


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
    """Serve the frontend"""
    return FileResponse("static/index.html")


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