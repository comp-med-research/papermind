"""
Paper-to-podcast export. Adapted from Open-NotebookLM.
Converts PDF content into a Host + Guest dialogue podcast (MP3).
Uses Claude for script generation (reliable JSON output).
"""
import io
import json
import os
import time
from pathlib import Path
from typing import Literal

from anthropic import Anthropic
from pydantic import BaseModel, Field

# ElevenLabs voice IDs for Host vs Guest (distinct voices)
VOICE_HOST = "21m00Tcm4TlvDq8ikWAM"   # Rachel - calm female
VOICE_GUEST = "pNInz6obpgDQGcFmaJgB"   # Adam - deep male

# MeloTTS via HuggingFace Spaces (free, no API key)
MELO_TTS_SPACE = "mrfakename/MeloTTS"
MELO_API = "/synthesize"

PODCAST_SYSTEM_PROMPT = """You are a world-class podcast producer transforming a research paper into an engaging podcast.

# Steps:
1. **Analyze** the text: identify key topics, findings, and interesting points.
2. **Craft dialogue** between Host (Jane) and Guest (expert on the topic):
   - Host initiates and asks questions
   - Guest explains concepts clearly
   - Natural, conversational flow with occasional "um" or "well"
   - PG-rated, no marketing
   - Host concludes the conversation
3. **Keep each line short**: max 100 characters (5–8 seconds when spoken).
4. **Ground responses** in the paper—no unsupported claims.

Output valid JSON only. Begin directly with the JSON object."""

LENGTH_MODIFIERS = {
    "short": "Keep it brief, 1–2 minutes total (about 8–12 dialogue lines).",
    "medium": "Aim for 3–5 minutes (about 18–25 dialogue lines).",
}


class DialogueItem(BaseModel):
    speaker: Literal["Host (Jane)", "Guest"]
    text: str


class PodcastDialogue(BaseModel):
    scratchpad: str
    name_of_guest: str
    dialogue: list[DialogueItem] = Field(..., description="List of host/guest dialogue items")


# Keep input reasonable for context (~32k chars ≈ 8 pages) — Claude handles it well
PODCAST_MAX_INPUT = 32_000

CLAUDE_MODEL = "claude-sonnet-4-6"


def generate_script(text: str, length: str = "medium") -> PodcastDialogue:
    """Generate podcast dialogue from paper text using Claude."""
    print("Podcast: Calling Claude for script...")
    if len(text) > PODCAST_MAX_INPUT:
        text = text[:PODCAST_MAX_INPUT] + "\n\n[Truncated for podcast...]"
    print(f"Podcast: Sending {len(text)} chars to Claude...")

    modifier = LENGTH_MODIFIERS.get(length, LENGTH_MODIFIERS["medium"])
    system = f"{PODCAST_SYSTEM_PROMPT}\n\n{modifier}"
    system += "\n\nReply with ONLY valid JSON. Keys: scratchpad, name_of_guest, dialogue (array of {speaker, text}). No markdown or explanation."

    client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    response = client.messages.create(
        model=os.getenv("PODCAST_CLAUDE_MODEL", CLAUDE_MODEL),
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": text}],
        temperature=0.7,
    )

    raw = response.content[0].text.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    try:
        data = json.loads(raw)
        # Normalize speaker: Claude may return "Host" instead of "Host (Jane)"
        for item in data.get("dialogue", []):
            sp = (item.get("speaker") or "").lower()
            item["speaker"] = "Guest" if "guest" in sp else "Host (Jane)"
        return PodcastDialogue(**data)
    except (json.JSONDecodeError, TypeError) as e:
        print(f"Podcast: Claude returned invalid JSON: {e}")
        print(f"Podcast: Raw output (first 500 chars): {raw[:500]}")
        raise RuntimeError("Could not parse podcast script as JSON.") from e


def _tts_melotts(text: str, speaker: str, accent: str = "EN-US", speed: float = 1.0) -> bytes:
    """Generate audio via MeloTTS HuggingFace Space."""
    try:
        from gradio_client import Client
        client = Client(MELO_TTS_SPACE)
        out_path = client.predict(
            text=text[:500],  # MeloTTS has length limits
            language="EN",
            speaker=accent,
            speed=speed,
            api_name=MELO_API,
        )
        if out_path and Path(out_path).exists():
            return Path(out_path).read_bytes()
        # Sometimes returns tuple (path, sample_rate)
        if isinstance(out_path, (list, tuple)) and out_path:
            p = Path(out_path[0])
            if p.exists():
                return p.read_bytes()
    except Exception as e:
        print(f"MeloTTS error: {e}")
    return b""


def _tts_runware(text: str) -> bytes:
    """Runware/ElevenLabs TTS — matches main.py text_to_speech exactly."""
    import uuid
    import base64
    import requests
    api_key = os.getenv("RUNWARE_API_KEY")
    if not api_key:
        return b""
    try:
        task_uuid = str(uuid.uuid4())
        response = requests.post(
            "https://api.runware.ai/v1",
            headers={"Authorization": f"Bearer {api_key}"},
            json=[{
                "taskType": "audioInference",
                "taskUUID": task_uuid,
                "model": "elevenlabs:24@1",
                "speech": {"text": text},
                "outputType": "base64Data",
                "outputFormat": "MP3",
                "numberResults": 1,
                "audioSettings": {"sampleRate": 44100, "bitrate": 192},
            }],
            timeout=90,
        )
        data = response.json()
        if "data" in data and data["data"]:
            b64 = data["data"][0].get("audioBase64Data")
            if b64:
                return base64.b64decode(b64)
        print(f"Runware TTS: unexpected response (status={response.status_code}) {str(data)[:200]}")
    except Exception as e:
        print(f"Runware TTS: {e}")
    return b""


def _segment_to_audio(text: str, speaker: str, use_runware: bool = False) -> bytes:
    """Generate audio for one dialogue line."""
    if use_runware:
        return _tts_runware(text)
    # MeloTTS: host = EN-Default, guest = EN-US (distinct voices)
    if speaker == "Host (Jane)":
        return _tts_melotts(text, speaker, accent="EN-Default", speed=1.0)
    return _tts_melotts(text, speaker, accent="EN-US", speed=0.9)


def generate_podcast_mp3(
    full_text: str,
    length: str = "medium",
    tts_func=None,
) -> tuple[bytes, str]:
    """
    Generate podcast MP3 and transcript from paper text.
    Uses tts_func if provided (same as main app), else Runware/MeloTTS.
    Returns (mp3_bytes, transcript_markdown).
    """
    from pydub import AudioSegment

    use_main_tts = callable(tts_func)
    use_runware = bool(os.getenv("RUNWARE_API_KEY"))
    print(f"Podcast: Starting (TTS: {'main app' if use_main_tts else 'Runware/MeloTTS'})...")

    script = generate_script(full_text, length)
    print(f"Podcast: Script ready ({len(script.dialogue)} lines). Generating audio...")

    segments = []
    transcript = []

    for i, item in enumerate(script.dialogue):
        label = "**Host**" if item.speaker == "Host (Jane)" else f"**{script.name_of_guest}**"
        transcript.append(f"{label}: {item.text}")
        print(f"Podcast: [{i+1}/{len(script.dialogue)}] {item.speaker}: {item.text[:40]}...")

        if use_main_tts:
            voice = VOICE_HOST if item.speaker == "Host (Jane)" else VOICE_GUEST
            audio_bytes = tts_func(item.text, voice_id=voice)
        else:
            if use_runware and i > 0:
                time.sleep(0.3)  # Throttle to avoid Runware rate limits
            audio_bytes = _segment_to_audio(item.text, item.speaker, use_runware=use_runware)
            if not audio_bytes:
                audio_bytes = _tts_runware(item.text)
        if not audio_bytes:
            print(f"Podcast: WARNING - no audio for line {i+1}, skipping")
            continue

        seg = AudioSegment.from_file(io.BytesIO(audio_bytes))
        segments.append(seg)

    if not segments:
        raise RuntimeError(
            "No audio generated. Set RUNWARE_API_KEY in .env for reliable podcast TTS."
        )

    print(f"Podcast: Combining {len(segments)} segments...")
    combined = sum(segments)
    buffer = io.BytesIO()
    combined.export(buffer, format="mp3", bitrate="128k")
    buffer.seek(0)

    transcript_text = "\n\n".join(transcript)
    print("Podcast: Done.")
    return buffer.read(), transcript_text
