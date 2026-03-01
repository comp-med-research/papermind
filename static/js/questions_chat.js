import { API_URL, state } from './config.js';
import { pauseReading } from './reading_chat.js';
import { addMessage, createStreamingMessage, showTypingIndicator, hideTypingIndicator } from './chat.js';

export async function sendMessage() {
    const input = document.getElementById('chatInput');
    const question = input.value.trim();
    if (!question) return;

    pauseReading();
    addMessage('user', question);
    input.value = '';
    input.style.height = 'auto';

    // Use streaming for text responses; fall back to regular endpoint for video
    // (video generation takes 2+ minutes and doesn't benefit from streaming)
    const needsVideo = state.activeResponseTypes.includes('video');
    if (!needsVideo) {
        await _sendStreaming(question);
    } else {
        await _sendRegular(question);
    }
}

async function _sendStreaming(question) {
    showTypingIndicator();
    let streamingMsg = null;

    try {
        const response = await fetch(`${API_URL}/interrupt/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question,
                session_id: state.sessionId,
                response_types: state.activeResponseTypes,
            }),
        });

        if (!response.ok) throw new Error(`Server error ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamStarted = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep any incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim();
                if (!raw) continue;

                let event;
                try { event = JSON.parse(raw); } catch { continue; }

                if (event.error) {
                    hideTypingIndicator();
                    if (streamingMsg) streamingMsg.finalize({ error: event.error });
                    else addMessage('ai', `❌ ${event.error}`);
                    return;
                }

                if (event.text) {
                    if (!streamStarted) {
                        hideTypingIndicator();
                        streamingMsg = createStreamingMessage();
                        streamStarted = true;
                    }
                    streamingMsg.appendText(event.text);
                }

                if (event.done) {
                    if (streamingMsg) {
                        streamingMsg.finalize({
                            sources: event.sources,
                            embeddingBackend: event.embedding_backend,
                            imageUrl: event.image_url,
                        });
                    }
                }
            }
        }
    } catch (error) {
        hideTypingIndicator();
        if (streamingMsg) streamingMsg.finalize({ error: error.message });
        else addMessage('ai', '❌ Sorry, I encountered an error: ' + error.message);
    }
}

async function _sendRegular(question) {
    showTypingIndicator();
    try {
        const response = await fetch(`${API_URL}/interrupt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question,
                session_id: state.sessionId,
                response_types: state.activeResponseTypes,
            }),
        });
        const data = await response.json();
        hideTypingIndicator();
        if (data.answer) {
            addMessage('ai', data.answer, {
                sources: data.sources,
                imageUrl: data.image_url,
                videoUrl: data.video_url,
                embeddingBackend: data.embedding_backend,
            });
        }
        if (data.summary) updateStats(data.summary);
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
