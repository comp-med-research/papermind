import { API_URL, state } from './config.js';
import { showReadingIndicator, hideReadingIndicator, updatePDFPosition } from './pdfViewer.js';
import { highlightSentence, clearHighlights, highlightCurrentWordInSentence, clearWordHighlights } from './textHighlight.js';
import { addMessage, addSystemMessage, updateReadingStatus } from './chat.js';

let wordHighlightTimeouts = [];

export function updatePlayPauseButton() {
    const btn = document.getElementById('playPauseBtn');
    if (!btn) return;
    if (state.isReading) {
        btn.textContent = '⏸';
        btn.title = 'Pause reading';
    } else {
        btn.textContent = '▶';
        btn.title = state.currentSentence ? 'Resume reading' : 'Start reading';
    }
}

export function togglePlayPause() {
    if (state.isReading) {
        pauseReading();
    } else {
        if (state.currentSentence) {
            resumeReading();
        } else {
            startReading();
        }
    }
}

export async function startReading() {
    try {
        const response = await fetch(`${API_URL}/start?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            addSystemMessage('❌ ' + (data.error || data.detail || `Server error ${response.status}`));
            state.isReading = false;
            updatePlayPauseButton();
            return;
        }

        if (data.done) {
            addSystemMessage('🎉 Paper complete! Great job!');
            hideReadingIndicator();
            clearHighlights();
            updateReadingStatus(null, false);
            state.currentSentence = null;
            state.isReading = false;
            updatePlayPauseButton();
            return;
        }

        if (data.proactive_flag) {
            addSystemMessage('⚠️ ' + data.flag_message);
        }

        updateReadingStatus(data.sentence, true);
        updateProgress(data.position);
        highlightSentence(data.sentence);

        // Set state BEFORE playAudio so onended auto-advance works for short audio
        state.currentSentence = data.sentence;
        state.isReading = true;
        updatePlayPauseButton();

        if (data.audio_b64) {
            playAudio(data.audio_b64, data.sentence);
        } else {
            // TTS unavailable — display sentence and advance automatically after a pause
            addSystemMessage(`📖 ${data.sentence}`);
            setTimeout(() => { if (state.isReading) startReading(); }, 3000);
        }

    } catch (error) {
        state.isReading = false;
        updatePlayPauseButton();
        addSystemMessage('❌ Error starting reading: ' + error.message);
    }
}

export function pauseReading() {
    if (state.currentAudio) {
        state.currentAudio.pause();
    }
    wordHighlightTimeouts.forEach((t) => clearTimeout(t));
    wordHighlightTimeouts = [];
    clearWordHighlights();
    updateReadingStatus(state.currentSentence, false);
    updatePlayPauseButton();
    hideReadingIndicator();
    state.isReading = false;
    addSystemMessage('⏸️ Reading paused');
}

export async function resumeReading() {
    try {
        const response = await fetch(`${API_URL}/resume?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (!response.ok || data.error) {
            addSystemMessage('❌ ' + (data.error || data.detail || `Server error ${response.status}`));
            state.isReading = false;
            updatePlayPauseButton();
            return;
        }

        if (data.done) {
            addSystemMessage('🎉 Paper complete!');
            hideReadingIndicator();
            clearHighlights();
            updateReadingStatus(null, false);
            state.currentSentence = null;
            state.isReading = false;
            updatePlayPauseButton();
            return;
        }

        updateReadingStatus(data.sentence, true);
        updateProgress(data.position);
        highlightSentence(data.sentence);

        state.currentSentence = data.sentence;
        state.isReading = true;
        updatePlayPauseButton();

        if (data.audio_b64) {
            playAudio(data.audio_b64, data.sentence);
        } else {
            addSystemMessage(`📖 ${data.sentence}`);
            setTimeout(() => { if (state.isReading) resumeReading(); }, 3000);
        }

        addSystemMessage('▶️ Reading resumed');

    } catch (error) {
        state.isReading = false;
        updatePlayPauseButton();
        addSystemMessage('❌ Error resuming reading: ' + error.message);
    }
}

export function playAudio(hexString, sentence) {
    wordHighlightTimeouts.forEach((t) => clearTimeout(t));
    wordHighlightTimeouts = [];

    const bytes = new Uint8Array(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    if (state.currentAudio) {
        state.currentAudio.pause();
    }

    const audio = new Audio(url);
    state.currentAudio = audio;

    function scheduleWordHighlights(duration) {
        if (!sentence) return;
        const words = sentence.split(/\s+/).filter((w) => w.length > 0);
        const timePerWord = duration / Math.max(1, words.length);
        words.forEach((_, index) => {
            const t = setTimeout(() => {
                if (state.currentAudio === audio) {
                    highlightCurrentWordInSentence(sentence, index);
                }
            }, timePerWord * index * 1000);
            wordHighlightTimeouts.push(t);
        });
    }

    // Set up all listeners BEFORE play() to avoid race conditions with Blob URLs
    audio.addEventListener('loadedmetadata', () => {
        scheduleWordHighlights(audio.duration || 3);
    }, { once: true });

    // Fallback: if loadedmetadata already fired or never fires, use canplaythrough
    audio.addEventListener('canplaythrough', () => {
        if (wordHighlightTimeouts.length === 0 && audio.duration) {
            scheduleWordHighlights(audio.duration);
        }
    }, { once: true });

    audio.onended = () => {
        wordHighlightTimeouts.forEach((t) => clearTimeout(t));
        wordHighlightTimeouts = [];
        if (state.isReading && state.currentAudio === audio) {
            setTimeout(() => startReading(), 500);
        }
    };

    audio.play().catch(err => console.warn('Audio play failed:', err));
}

export function updateProgress(position) {
    document.getElementById('statPosition').textContent = position;
    updatePDFPosition(position);
}

export async function startFromSentence(sentenceText) {
    console.log('Start from sentence requested:', sentenceText);
    
    import('./textHighlight.js').then(module => {
        module.highlightSentence(sentenceText);
    });
    
    addSystemMessage('📍 Clicked sentence highlighted. Full click-to-start coming soon!');
}
