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


# ── Live conversation ──────────────────────────────────────────────────────────

async def live_respond(
    message: str,
    system_prompt: str,
    history: list[dict],  # [{"role": "user"|"model", "text": "..."}]
) -> tuple[bytes, str]:
    """
    Send one turn to Gemini Live with full conversation history injected
    into the system prompt.

    Returns:
        (wav_bytes, response_text)
        wav_bytes  — 24 kHz mono PCM wrapped in a WAV container
        response_text — transcript of what Gemini said (may be empty if
                        output_audio_transcription isn't supported on the
                        active billing tier)
    """
    client = _live_client()

    # Inject conversation history into system prompt so each new session
    # feels like a continuous conversation
    history_block = ""
    if history:
        lines = []
        for h in history[-10:]:  # last 5 back-and-forths
            speaker = "User" if h["role"] == "user" else "You"
            lines.append(f"{speaker}: {h['text']}")
        history_block = "\n\nCONVERSATION SO FAR:\n" + "\n".join(lines)

    full_system = system_prompt + history_block

    config = types.LiveConnectConfig(
        system_instruction=types.Content(
            parts=[types.Part(text=full_system)]
        ),
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=VOICE_NAME
                )
            )
        ),
    )

    wav_buffer = io.BytesIO()
    wf = wave.open(wav_buffer, "wb")
    wf.setnchannels(1)
    wf.setsampwidth(2)          # 16-bit
    wf.setframerate(WAV_SAMPLE_RATE)

    response_text = ""

    try:
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:
            # Send just the current user message (history is in system prompt)
            await session.send_client_content(
                turns=[
                    types.Content(
                        role="user",
                        parts=[types.Part(text=message)],
                    )
                ]
            )

            async for msg in session.receive():
                sc = msg.server_content
                if sc and sc.model_turn:
                    for part in sc.model_turn.parts:
                        # Collect PCM audio
                        if (
                            part.inline_data
                            and part.inline_data.mime_type.startswith("audio/pcm")
                        ):
                            raw = part.inline_data.data
                            # SDK may return raw bytes or a base64 string
                            if isinstance(raw, (bytes, bytearray)):
                                wf.writeframes(raw)
                            else:
                                # base64 string — add padding if needed
                                s = raw + '=' * (-len(raw) % 4)
                                wf.writeframes(base64.b64decode(s))
                        # Collect text transcript (if available)
                        if part.text:
                            response_text += part.text

                if sc and getattr(sc, "turn_complete", False):
                    break

    except Exception as e:
        print(f"[gemini_live] Live response error: {e}")
        traceback.print_exc()
    finally:
        wf.close()

    return wav_buffer.getvalue(), response_text
