import { state } from './config.js';

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
    voiceBtn.textContent = '🎤 Listening...';
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
        onResult(transcript);
    };
    
    recognition.onerror = (event) => {
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
        onError(event.error);
    };
    
    recognition.onend = () => {
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
    };
    
    try {
        recognition.start();
    } catch (error) {
        voiceBtn.classList.remove('recording');
        voiceBtn.textContent = '🎤';
        alert('Error starting voice input: ' + error.message);
    }
}
