import { API_URL, state } from './config.js';
import { pauseReading, playAudio } from './reading_chat.js';
import { addMessage, showTypingIndicator, hideTypingIndicator } from './chat.js';

export async function sendMessage() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    
    if (!question) {
        return;
    }
    
    // Pause reading
    pauseReading();
    
    // Add user message to chat
    addMessage('user', question);
    
    // Clear input
    input.value = '';
    input.style.height = 'auto';
    
    // Show typing indicator
    showTypingIndicator();
    
    try {
        const response = await fetch(`${API_URL}/interrupt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question: question,
                session_id: state.sessionId,
                response_types: state.activeResponseTypes
            })
        });

        const data = await response.json();
        
        // Hide typing indicator
        hideTypingIndicator();
        
        // Add AI response
        if (data.answer) {
            addMessage('ai', data.answer, {
                sources: data.sources,
                imageUrl: data.image_url,
                videoUrl: data.video_url,
                embeddingBackend: data.embedding_backend
            });
        }
        
        // Play voice if requested
        if (state.activeResponseTypes.includes('voice') && data.audio_b64) {
            playAudio(data.audio_b64);
        }
        
        // Update stats
        if (data.summary) {
            updateStats(data.summary);
        }

    } catch (error) {
        hideTypingIndicator();
        addMessage('ai', '❌ Sorry, I encountered an error: ' + error.message);
    }
}

export function handleVoiceInput() {
    import('./voiceInput_chat.js').then(module => {
        module.startVoiceInput(
            (transcript) => {
                document.getElementById('chatInput').value = transcript;
                document.getElementById('chatInput').focus();
            },
            (error) => {
                console.error('Voice input error:', error);
                addMessage('ai', '❌ Voice input error: ' + error);
            }
        );
    });
}

function updateStats(summary) {
    document.getElementById('statQuestions').textContent = summary.questions_asked || 0;
    document.getElementById('statProgress').textContent = summary.percent + '%';
    
    if (summary.progress) {
        const parts = summary.progress.split('/');
        if (parts.length === 2) {
            state.totalSentences = parseInt(parts[1]);
        }
    }
}

// Auto-resize textarea
export function initChatInput() {
    const input = document.getElementById('chatInput');
    
    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });
    
    // Enter to send (Shift+Enter for new line)
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}
