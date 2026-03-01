import { state } from './config.js';

const MIC_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;

export function initVoiceInput() {
    // Check if browser supports speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn('Speech recognition not supported in this browser');
        return null;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    return recognition;
}

export function startVoiceInput(onResult, onError) {
    const recognition = initVoiceInput();
    
    if (!recognition) {
        alert('Voice input is not supported in your browser. Please use Chrome or Edge.');
        return;
    }
    
    const voiceBtn = document.getElementById('voiceBtn');
    voiceBtn.classList.add('recording');
    voiceBtn.innerHTML = MIC_SVG;

    const reset = () => {
        voiceBtn.classList.remove('recording');
        voiceBtn.innerHTML = MIC_SVG;
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        reset();
        onResult(transcript);
    };

    recognition.onerror = (event) => {
        reset();
        onError(event.error);
    };

    recognition.onend = () => reset();

    try {
        recognition.start();
    } catch (error) {
        reset();
        alert('Error starting voice input: ' + error.message);
    }
}
