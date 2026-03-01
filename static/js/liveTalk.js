/**
 * PaperMind — Interactive Session (Gemini Live)
 *
 * One button press starts a continuous voice conversation.
 * VAD (silence detection) auto-sends when you stop speaking.
 * Gemini responds, then automatically listens again.
 * Press the button again to end the session.
 */

import { API_URL, state } from './config.js';
import { addMessage } from './chat.js';

// ── VAD config ─────────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD  = 18;    // 0-255 average amplitude
const SILENCE_DURATION   = 100;   // ms of silence before auto-sending
const MIN_SPEECH_MS      = 200;   // ignore blips shorter than this

// ── Session state ──────────────────────────────────────────────────────────────
let sessionActive    = false;
let mediaStream      = null;
let mediaRecorder    = null;
let audioChunks      = [];
let audioContext     = null;
let analyser         = null;
let currentAudio     = null;

// 'idle' | 'listening' | 'recording' | 'processing' | 'playing'
let phase            = 'idle';
let silenceTimer     = null;
let speechStart      = null;
let vadActive        = false;

// ── SVG icons ─────────────────────────────────────────────────────────────────
const ICON_MIC  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
const ICON_END  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;

// ── Init ───────────────────────────────────────────────────────────────────────
export function initLiveTalk() {
    const btn = document.getElementById('liveTalkBtn');
    if (!btn) return;
    btn.addEventListener('click', handleToggle);
    renderBtn();
}

// ── Session toggle ─────────────────────────────────────────────────────────────
async function handleToggle() {
    if (sessionActive) {
        endSession();
    } else {
        await startSession();
    }
}

async function startSession() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });

        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext.createMediaStreamSource(mediaStream).connect(analyser);

        sessionActive = true;
        renderBtn();
        beginListening();
    } catch (e) {
        alert('Microphone access denied. Please allow mic access and try again.');
    }
}

function endSession() {
    sessionActive = false;
    vadActive = false;
    clearTimeout(silenceTimer);
    silenceTimer = null;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }

    // Clear server-side conversation history for this session
    fetch(`${API_URL}/live/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: state.sessionId || 'default' }),
    }).catch(() => {});

    phase = 'idle';
    audioChunks = [];
    mediaStream = null;
    mediaRecorder = null;
    analyser = null;

    renderBtn();
    setStatus('');
}

// ── Listening loop ─────────────────────────────────────────────────────────────
function beginListening() {
    if (!sessionActive) return;

    phase = 'listening';
    audioChunks = [];
    setStatus('Listening…');

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = onRecordingDone;
    mediaRecorder.start(100);

    if (!vadActive) {
        vadActive = true;
        runVAD();
    }
}

// ── VAD (Voice Activity Detection) ─────────────────────────────────────────────
function runVAD() {
    if (!sessionActive || !analyser) { vadActive = false; return; }

    // Don't process speech while Gemini is talking or we're waiting on the server
    if (phase === 'processing' || phase === 'playing') {
        requestAnimationFrame(runVAD);
        return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const speaking = avg > SILENCE_THRESHOLD;

    if (speaking) {
        // User is talking
        if (!speechStart) speechStart = Date.now();
        clearTimeout(silenceTimer);
        silenceTimer = null;

        if (phase === 'listening') {
            phase = 'recording';
            setStatus('Speaking…');
        }
    } else if (phase === 'recording' && !silenceTimer) {
        // Silence after speech — start countdown to send
        silenceTimer = setTimeout(() => {
            silenceTimer = null;
            if (phase !== 'recording' || !sessionActive) return;

            const duration = Date.now() - (speechStart || 0);
            speechStart = null;

            if (duration >= MIN_SPEECH_MS) {
                // Long enough — send it
                phase = 'processing';
                setStatus('Thinking…');
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                }
            } else {
                // Too short (cough, click, etc.) — reset
                phase = 'listening';
                setStatus('Listening…');
            }
        }, SILENCE_DURATION);
    }

    requestAnimationFrame(runVAD);
}

// ── Send audio to backend ──────────────────────────────────────────────────────
async function onRecordingDone() {
    if (!sessionActive || audioChunks.length === 0) {
        if (sessionActive) beginListening();
        return;
    }

    const blob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
    audioChunks = [];

    try {
        const base64 = await blobToBase64(blob);

        const res = await fetch(`${API_URL}/live/talk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: state.sessionId || 'default',
                audio_base64: base64,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

        if (data.user_transcript) addMessage('user', data.user_transcript);
        if (data.response_transcript) addMessage('ai', data.response_transcript);

        if (data.audio_base64 && sessionActive) {
            await playResponse(data.audio_base64);
        }
    } catch (e) {
        console.error('[liveTalk]', e);
        addMessage('ai', '❌ ' + e.message);
    } finally {
        // Always go back to listening if session still active
        if (sessionActive) beginListening();
    }
}

// ── Playback ───────────────────────────────────────────────────────────────────
async function playResponse(audioBase64) {
    phase = 'playing';
    setStatus('Responding…');

    const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'audio/wav' });
    currentAudio = new Audio(URL.createObjectURL(blob));

    await new Promise(resolve => {
        currentAudio.onended = resolve;
        currentAudio.onerror = resolve;
        currentAudio.play().catch(resolve);
    });
    currentAudio = null;
}

// ── UI ─────────────────────────────────────────────────────────────────────────
function renderBtn() {
    const btn = document.getElementById('liveTalkBtn');
    if (!btn) return;
    btn.classList.remove('talk-idle', 'talk-session-active');

    if (sessionActive) {
        btn.classList.add('talk-session-active');
        btn.innerHTML = ICON_END + ' End Session';
        btn.title = 'End interactive session';
    } else {
        btn.classList.add('talk-idle');
        btn.innerHTML = ICON_MIC + ' Interactive Session';
        btn.title = 'Start a live voice conversation about the paper';
    }
}

function setStatus(msg) {
    const el = document.getElementById('talkStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
}

// ── Util ───────────────────────────────────────────────────────────────────────
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
