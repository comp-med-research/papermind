import { API_URL, state } from './config.js';
import { showReadingIndicator, hideReadingIndicator, updatePDFPosition } from './pdfViewer.js';
import { updateStats } from './session.js';

export async function startReading() {
    try {
        const response = await fetch(`${API_URL}/start?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.done) {
            document.getElementById('sentenceText').textContent = '🎉 Paper complete!';
            hideReadingIndicator();
            return;
        }

        if (data.proactive_flag) {
            document.getElementById('flagMessage').textContent = data.flag_message;
            document.getElementById('flagMessage').classList.remove('hidden');
        } else {
            document.getElementById('flagMessage').classList.add('hidden');
        }

        document.getElementById('sentenceText').textContent = data.sentence;
        updateProgress(data.position);

        // Show reading indicator on PDF
        showReadingIndicator();

        // Play audio
        if (data.audio_b64) {
            playAudio(data.audio_b64);
        }

        // Update UI
        document.getElementById('startBtn').classList.add('hidden');
        document.getElementById('pauseBtn').classList.remove('hidden');
        state.isReading = true;

    } catch (error) {
        alert('Error starting reading: ' + error.message);
    }
}

export function pauseReading() {
    if (state.currentAudio) {
        state.currentAudio.pause();
    }
    document.getElementById('pauseBtn').classList.add('hidden');
    document.getElementById('resumeBtn').classList.remove('hidden');
    hideReadingIndicator();
    state.isReading = false;
}

export async function resumeReading() {
    try {
        const response = await fetch(`${API_URL}/resume?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.done) {
            document.getElementById('sentenceText').textContent = '🎉 Paper complete!';
            hideReadingIndicator();
            return;
        }

        document.getElementById('sentenceText').textContent = data.sentence;
        updateProgress(data.position);

        // Show reading indicator
        showReadingIndicator();

        if (data.audio_b64) {
            playAudio(data.audio_b64);
        }

        document.getElementById('resumeBtn').classList.add('hidden');
        document.getElementById('pauseBtn').classList.remove('hidden');
        document.getElementById('answerDisplay').classList.add('hidden');
        state.isReading = true;

    } catch (error) {
        alert('Error resuming reading: ' + error.message);
    }
}

export function playAudio(hexString) {
    // Convert hex string to audio
    const bytes = new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    if (state.currentAudio) {
        state.currentAudio.pause();
    }

    state.currentAudio = new Audio(url);
    state.currentAudio.play();

    // Auto-advance to next sentence when audio finishes
    state.currentAudio.onended = () => {
        if (state.isReading) {
            setTimeout(() => startReading(), 1000);
        }
    };
}

export function updateProgress(position) {
    document.getElementById('statPosition').textContent = position;
    updatePDFPosition(position);
}
