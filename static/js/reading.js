import { API_URL, state } from './config.js';
import { showReadingIndicator, hideReadingIndicator, updatePDFPosition } from './pdfViewer.js';
import { updateStats } from './session.js';
import { highlightSentence, clearHighlights } from './textHighlight.js';

export async function startReading() {
    try {
        const response = await fetch(`${API_URL}/start?session_id=${state.sessionId}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.done) {
            document.getElementById('sentenceText').textContent = '🎉 Paper complete!';
            hideReadingIndicator();
            clearHighlights();
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

        // Highlight the sentence in PDF
        highlightSentence(data.sentence);

        // Show reading indicator on PDF
        showReadingIndicator();

        // Store current sentence for click-to-start
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
    // Keep highlights visible when paused
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
            clearHighlights();
            return;
        }

        document.getElementById('sentenceText').textContent = data.sentence;
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
        document.getElementById('answerDisplay').classList.add('hidden');
        state.isReading = true;

    } catch (error) {
        alert('Error resuming reading: ' + error.message);
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

    // Optional: Word-by-word highlighting (basic estimation)
    if (sentence) {
        const words = sentence.split(/\s+/);
        const audioDuration = state.currentAudio.duration || 3; // fallback
        
        // Wait for audio to load duration
        state.currentAudio.addEventListener('loadedmetadata', () => {
            const duration = state.currentAudio.duration;
            const timePerWord = duration / words.length;
            
            // Highlight words progressively (basic implementation)
            // For more accuracy, would need word timestamps from TTS API
            words.forEach((word, index) => {
                setTimeout(() => {
                    import('./textHighlight.js').then(module => {
                        module.highlightWord(word);
                    });
                }, timePerWord * index * 1000);
            });
        });
    }

    // Auto-advance to next sentence when audio finishes
    state.currentAudio.onended = () => {
        if (state.isReading) {
            setTimeout(() => startReading(), 1000);
        }
    };
}

// New function: Start reading from a specific sentence (for click-to-start)
export async function startFromSentence(sentenceText) {
    // This would need backend support to find sentence position
    // For now, just highlight
    console.log('Start from sentence requested:', sentenceText);
    
    import('./textHighlight.js').then(module => {
        module.highlightSentence(sentenceText);
    });
    
    // TODO: Add API endpoint to find sentence index and start from there
    // const response = await fetch(`${API_URL}/start-from-sentence`, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ sentence: sentenceText, session_id: state.sessionId })
    // });
}

export function updateProgress(position) {
    document.getElementById('statPosition').textContent = position;
    updatePDFPosition(position);
}
