"""
Gemini Live API integration for PaperMind.

Handles:
  - Audio transcription (WebM → text via Gemini Flash)
  - Multi-turn voice conversation with paper context (Gemini Live → WAV audio)

Session history is maintained by the caller (main.py) and injected into the
system prompt each turn, so each Gemini Live session starts fresh but has
full conversational memory.
"""

import os
import io
import wave
import base64
import asyncio
import subprocess
import traceback
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

# ── Constants ─────────────────────────────────────────────────────────────────

LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
TRANSCRIBE_MODEL = "gemini-3-flash-preview"
VOICE_NAME = "Puck"   # Aoede | Puck | Charon | Kore | Fenrir | Leda | Orus | Zephyr
WAV_SAMPLE_RATE = 24000   # Gemini Live outputs PCM at 24 kHz


def _live_client() -> genai.Client:
    """Client for Gemini Live API (requires v1alpha)."""
    return genai.Client(
        api_key=os.getenv("GEMINI_API_KEY"),
        http_options={"api_version": "v1alpha"},
    )

def _generate_client() -> genai.Client:
    """Client for regular generateContent."""
    return genai.Client(
        api_key=os.getenv("GEMINI_API_KEY"),
    )


# ── Transcription ──────────────────────────────────────────────────────────────

async def transcribe_audio(audio_bytes: bytes) -> str:
    """
    Transcribe browser audio (WebM/opus) using Gemini Flash.
    Returns plain text, or empty string on failure.
    """
    client = _generate_client()
    try:
        audio_part = types.Part(
            inline_data=types.Blob(
                data=audio_bytes,
                mime_type="audio/webm;codecs=opus",
            )
        )
        response = await client.aio.models.generate_content(
            model=TRANSCRIBE_MODEL,
            contents=[
                "Transcribe exactly what was said. Return only the transcription, no extra commentary.",
                audio_part,
            ],
        )
        return (response.text or "").strip()
    except Exception as e:
        print(f"[gemini_live] Transcription error: {e}")
        return ""


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _build_config(full_system: str, disable_vad: bool = False) -> types.LiveConnectConfig:
    kwargs: dict = dict(
        system_instruction=types.Content(parts=[types.Part(text=full_system)]),
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE_NAME)
            )
        ),
    )
    if disable_vad:
        # When we send a complete audio clip we control start/end ourselves,
        # so server-side VAD must be disabled.
        kwargs["realtime_input_config"] = types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)
        )
    return types.LiveConnectConfig(**kwargs)


async def _webm_to_pcm(audio_bytes: bytes) -> bytes:
    """Convert browser WebM/Opus audio to raw PCM 16 kHz mono s16le via ffmpeg."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-i", "pipe:0",
        "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000",
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    pcm_bytes, stderr = await proc.communicate(input=audio_bytes)
    if proc.returncode != 0:
        print(f"[gemini_live] ffmpeg error: {stderr.decode()}")
        return b""
    return pcm_bytes

def _history_block(history: list[dict]) -> str:
    if not history:
        return ""
    lines = [
        f"{'User' if h['role'] == 'user' else 'You'}: {h['text']}"
        for h in history[-10:]
    ]
    return "\n\nCONVERSATION SO FAR:\n" + "\n".join(lines)

def _write_pcm(wf: wave.Wave_write, raw) -> None:
    if isinstance(raw, (bytes, bytearray)):
        wf.writeframes(raw)
    else:
        s = raw + '=' * (-len(raw) % 4)
        wf.writeframes(base64.b64decode(s))


# ── Live conversation (audio input) ────────────────────────────────────────────

async def live_respond_from_audio(
    audio_bytes: bytes,
    system_prompt: str,
    history: list[dict],
) -> tuple[bytes, str, str]:
    """
    Convert browser WebM audio → PCM with ffmpeg, then send to Gemini Live
    via send_realtime_input (the correct Live API method for audio).

    Returns:
        (wav_bytes, user_transcript, response_text)
        wav_bytes       — 24 kHz mono WAV of Gemini's spoken reply
        user_transcript — empty string (Live API doesn't transcribe input audio
                          in this flow; transcript is captured on the next turn)
        response_text   — what Gemini said (from output_audio_transcription)
    """
    # Convert WebM/Opus → PCM 16 kHz mono (what Gemini Live expects)
    pcm_bytes = await _webm_to_pcm(audio_bytes)
    if not pcm_bytes:
        print("[gemini_live] ffmpeg conversion failed — no PCM output")
        return b"", "", ""

    client = _live_client()
    full_system = system_prompt + _history_block(history)
    # disable_vad=True so we control turn boundaries with activity_start/end
    config = _build_config(full_system, disable_vad=True)

    wav_buffer = io.BytesIO()
    wf = wave.open(wav_buffer, "wb")
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(WAV_SAMPLE_RATE)

    response_text = ""

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:
            # Manually bracket the audio with activity signals so Gemini knows
            # exactly when the user's turn starts and ends.
            await session.send_realtime_input(activity_start=types.ActivityStart())
            await session.send_realtime_input(
                audio=types.Blob(data=pcm_bytes, mime_type="audio/pcm")
            )
            await session.send_realtime_input(activity_end=types.ActivityEnd())

            async for msg in session.receive():
                sc = msg.server_content
                if not sc:
                    continue

                if sc.model_turn:
                    for part in sc.model_turn.parts:
                        if (
                            part.inline_data
                            and part.inline_data.mime_type.startswith("audio/pcm")
                        ):
                            _write_pcm(wf, part.inline_data.data)
                        if part.text:
                            response_text += part.text

                if getattr(sc, "turn_complete", False):
                    break

    except Exception as e:
        print(f"[gemini_live] live_respond_from_audio error: {e}")
        traceback.print_exc()
    finally:
        wf.close()

    return wav_buffer.getvalue(), "", response_text.strip()


# ── Live conversation (text input) — kept for backwards compat ─────────────────

async def live_respond(
    message: str,
    system_prompt: str,
    history: list[dict],
) -> tuple[bytes, str]:
    """Text-turn version. Returns (wav_bytes, response_text)."""
    client = _live_client()
    full_system = system_prompt + _history_block(history)
    config = _build_config(full_system)

    wav_buffer = io.BytesIO()
    wf = wave.open(wav_buffer, "wb")
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(WAV_SAMPLE_RATE)
    response_text = ""

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:
            await session.send_client_content(
                turns=[types.Content(role="user", parts=[types.Part(text=message)])]
            )
            async for msg in session.receive():
                sc = msg.server_content
                if sc and sc.model_turn:
                    for part in sc.model_turn.parts:
                        if part.inline_data and part.inline_data.mime_type.startswith("audio/pcm"):
                            _write_pcm(wf, part.inline_data.data)
                        if part.text:
                            response_text += part.text
                if sc and getattr(sc, "turn_complete", False):
                    break
    except Exception as e:
        print(f"[gemini_live] live_respond error: {e}")
        traceback.print_exc()
    finally:
        wf.close()

    return wav_buffer.getvalue(), response_text
