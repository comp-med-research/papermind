import { API_URL, state } from './config.js';
import { showReadingIndicator, hideReadingIndicator, updatePDFPosition } from './pdfViewer.js';
import { highlightSentence, clearHighlights } from './textHighlight.js';
import { addMessage, addSystemMessage, updateReadingStatus } from './chat.js';

export async function startReading() {
    try {
        const response = await fetch(`${API_URL}/start?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.done) {
            addSystemMessage('🎉 Paper complete! Great job!');
            hideReadingIndicator();
            clearHighlights();
            updateReadingStatus(null);
            return;
        }

        if (data.proactive_flag) {
            addSystemMessage('⚠️ ' + data.flag_message);
        }

        // Update reading status
        updateReadingStatus(data.sentence);

        // Update progress
        updateProgress(data.position);

        // Highlight the sentence in PDF
        highlightSentence(data.sentence);

        // Show reading indicator on PDF
        showReadingIndicator();

        // Store current sentence
        state.currentSentence = data.sentence;

        // Play audio
        if (data.audio_b64) {
            playAudio(data.audio_b64, data.sentence);
        }

        // Update UI
        document.getElementById('startBtn').classList.add('hidden');
        document.getElementById('pauseBtn').classList.remove('hidden');
        state.isReading = true;

    } catch (error) {
        addSystemMessage('❌ Error starting reading: ' + error.message);
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
    addSystemMessage('⏸️ Reading paused');
}

export async function resumeReading() {
    try {
        const response = await fetch(`${API_URL}/resume?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.done) {
            addSystemMessage('🎉 Paper complete!');
            hideReadingIndicator();
            clearHighlights();
            updateReadingStatus(null);
            return;
        }

        // Update reading status
        updateReadingStatus(data.sentence);

        updateProgress(data.position);

        // Highlight the sentence in PDF
        highlightSentence(data.sentence);

        // Show reading indicator
        showReadingIndicator();

        // Store current sentence
        state.currentSentence = data.sentence;

        if (data.audio_b64) {
            playAudio(data.audio_b64, data.sentence);
        }

        document.getElementById('resumeBtn').classList.add('hidden');
        document.getElementById('pauseBtn').classList.remove('hidden');
        state.isReading = true;

        addSystemMessage('▶️ Reading resumed');

    } catch (error) {
        addSystemMessage('❌ Error resuming reading: ' + error.message);
    }
}

export function playAudio(hexString, sentence) {
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

export async function startFromSentence(sentenceText) {
    console.log('Start from sentence requested:', sentenceText);
    
    import('./textHighlight.js').then(module => {
        module.highlightSentence(sentenceText);
    });
    
    addSystemMessage('📍 Clicked sentence highlighted. Full click-to-start coming soon!');
}
