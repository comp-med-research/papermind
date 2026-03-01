import { API_URL, state } from './config.js';
import { jumpToPage } from './pdfViewer.js';

/** Lightweight markdown → HTML renderer (no external dependency) */
function renderMarkdown(text) {
    // Strip VISUAL prompt blocks the backend sometimes appends
    text = text
        .replace(/\*\*VISUAL\*\*:[\s\S]*$/i, '')
        .replace(/\[VISUAL[\s\S]*?\]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Escape HTML special chars first
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = text.split('\n');
    const out = [];
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Fenced code blocks (``` ... ```)
        if (line.trim().startsWith('```')) {
            if (inList) { out.push('</ul>'); inList = false; }
            out.push('<pre><code>');
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                out.push(esc(lines[i]) + '\n');
                i++;
            }
            out.push('</code></pre>');
            continue;
        }

        // Headers
        const hMatch = line.match(/^(#{1,3})\s+(.+)/);
        if (hMatch) {
            if (inList) { out.push('</ul>'); inList = false; }
            const lvl = Math.min(hMatch[1].length + 2, 6); // map # → h3, ## → h4 (keeps size reasonable)
            out.push(`<h${lvl}>${inlineFormat(esc(hMatch[2]))}</h${lvl}>`);
            continue;
        }

        // Bullet list items (* or -)
        const listMatch = line.match(/^[\*\-]\s+(.+)/);
        if (listMatch) {
            if (!inList) { out.push('<ul>'); inList = true; }
            out.push(`<li>${inlineFormat(esc(listMatch[1]))}</li>`);
            continue;
        }

        // Close list on blank or non-list line
        if (inList && !listMatch) {
            out.push('</ul>');
            inList = false;
        }

        // Blank line → paragraph break
        if (line.trim() === '') {
            out.push('<br>');
            continue;
        }

        out.push(`<p>${inlineFormat(esc(line))}</p>`);
    }

    if (inList) out.push('</ul>');
    return out.join('');
}

function inlineFormat(s) {
    return s
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
}

// Active response types (voice removed — use per-message read-aloud button instead)
state.activeResponseTypes = ['text'];

export function toggleResponseType(type) {
    const chip = document.querySelector(`.response-type-chip[data-type="${type}"]`);
    
    if (chip.classList.contains('active')) {
        chip.classList.remove('active');
        state.activeResponseTypes = state.activeResponseTypes.filter(t => t !== type);
    } else {
        chip.classList.add('active');
        state.activeResponseTypes.push(type);
    }
    
    console.log('Active response types:', state.activeResponseTypes);
}

export function addMessage(role, content, options = {}) {
    const messagesContainer = document.getElementById('chatMessages');
    
    // Remove empty state if present
    const emptyState = messagesContainer.querySelector('.chat-empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}-avatar`;
    avatar.textContent = role === 'user' ? '👤' : '🤖';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // 'ai' is the role used by questions_chat.js
    if (role === 'ai' || role === 'assistant') {
        bubble.innerHTML = renderMarkdown(content);
    } else {
        bubble.textContent = content;
    }

    messageContent.appendChild(bubble);
    
    // Add timestamp and embedding pathway
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    let metaHtml = `<span class="message-time">${time}</span>`;
    if (options.embeddingBackend) {
        const backendLabel = options.embeddingBackend === 'nvidia' ? 'NVIDIA Nemotron' : 
            options.embeddingBackend === 'sentence-transformers' ? 'sentence-transformers' : '';
        if (backendLabel) {
            metaHtml += ` <span class="embedding-badge">🔍 ${backendLabel}</span>`;
        }
    }
    meta.innerHTML = metaHtml;

    // Read-aloud button in meta row for AI messages
    if (role === 'ai' || role === 'assistant') {
        const readAloudBtn = document.createElement('button');
        readAloudBtn.className = 'read-aloud-btn';
        readAloudBtn.title = 'Read aloud';
        readAloudBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>`;

        let ttsAudio = null;
        // true = playing, false = paused, null = not yet loaded
        let audioState = null;

        const ICON_PLAY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
        const ICON_PAUSE = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        const ICON_LOADING = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

        readAloudBtn.addEventListener('click', async () => {
            // If audio is loaded and playing — pause it
            if (ttsAudio && audioState === true) {
                ttsAudio.pause();
                audioState = false;
                readAloudBtn.innerHTML = ICON_PLAY;
                readAloudBtn.classList.remove('playing');
                readAloudBtn.title = 'Resume';
                return;
            }

            // If audio is loaded but paused — resume from same position
            if (ttsAudio && audioState === false) {
                ttsAudio.play();
                audioState = true;
                readAloudBtn.innerHTML = ICON_PAUSE;
                readAloudBtn.classList.add('playing');
                readAloudBtn.title = 'Pause';
                return;
            }

            // First click — fetch TTS audio
            readAloudBtn.innerHTML = ICON_LOADING;
            readAloudBtn.disabled = true;

            try {
                const plainText = bubble.textContent.trim();
                const res = await fetch(`${API_URL}/tts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: plainText, session_id: state.sessionId }),
                });
                const data = await res.json();
                if (!res.ok || !data.audio_base64) throw new Error(data.error || 'TTS failed');

                const bytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
                const blob = new Blob([bytes], { type: 'audio/mpeg' });
                ttsAudio = new Audio(URL.createObjectURL(blob));

                ttsAudio.addEventListener('ended', () => {
                    audioState = false;
                    ttsAudio.currentTime = 0; // reset so next click replays from start
                    audioState = null;
                    ttsAudio = null;
                    readAloudBtn.innerHTML = ICON_PLAY;
                    readAloudBtn.classList.remove('playing');
                    readAloudBtn.title = 'Read aloud';
                });

                await ttsAudio.play();
                audioState = true;
                readAloudBtn.innerHTML = ICON_PAUSE;
                readAloudBtn.classList.add('playing');
                readAloudBtn.title = 'Pause';
            } catch (e) {
                console.error('Read aloud error:', e);
                readAloudBtn.innerHTML = ICON_PLAY;
            } finally {
                readAloudBtn.disabled = false;
            }
        });

        meta.appendChild(readAloudBtn);
    }

    messageContent.appendChild(meta);
    
    // Add sources if available
    if (options.sources && options.sources.length > 0) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'message-sources';
        sourcesDiv.innerHTML = '<h4>📚 Sources</h4>';
        
        options.sources.forEach(source => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'source-chip';
            chip.style.cursor = 'pointer';
            
            const textSpan = document.createElement('span');
            textSpan.textContent = source.text.substring(0, 50) + (source.text.length > 50 ? '...' : '');
            chip.appendChild(textSpan);
            
            const pageNum = source.page != null ? parseInt(source.page, 10) : null;
            if (pageNum != null && !isNaN(pageNum)) {
                const badge = document.createElement('span');
                badge.className = 'page-badge';
                badge.textContent = ` p${pageNum}`;
                chip.appendChild(badge);
            }
            
            const sourceText = source.text;
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const pdfContainer = document.getElementById('pdfViewerContainer');
                if (pdfContainer) {
                    pdfContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                
                if (pageNum != null && !isNaN(pageNum) && state.pdfDoc) {
                    const textForHighlight = sourceText.replace(/\*+/g, '').replace(/^["']+|["']+$/g, '').replace(/\.{2,}$/, '').trim();
                    jumpToPage(pageNum, textForHighlight);
                } else {
                    addSystemMessage('📄 Page could not be located for this source. Try scrolling the PDF manually.');
                }
            });
            
            sourcesDiv.appendChild(chip);
        });
        
        messageContent.appendChild(sourcesDiv);
    }
    
    // Add visual media if available
    if (options.imageUrl) {
        const visualDiv = document.createElement('div');
        visualDiv.className = 'message-visual';
        const img = document.createElement('img');
        img.src = options.imageUrl;
        img.alt = 'Visual explanation';
        visualDiv.appendChild(img);
        messageContent.appendChild(visualDiv);
    }
    
    if (options.videoUrl) {
        const visualDiv = document.createElement('div');
        visualDiv.className = 'message-visual';
        const video = document.createElement('video');
        video.src = options.videoUrl;
        video.controls = true;
        visualDiv.appendChild(video);
        messageContent.appendChild(visualDiv);
    }
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(messageContent);
    
    messagesContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageDiv;
}

export function addSystemMessage(text) {
    const messagesContainer = document.getElementById('chatMessages');
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-message';
    systemDiv.textContent = text;
    messagesContainer.appendChild(systemDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

export function showTypingIndicator() {
    const messagesContainer = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message ai-message';
    typingDiv.id = 'typingIndicator';
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar ai-avatar';
    avatar.textContent = '🤖';
    
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    
    typingDiv.appendChild(avatar);
    typingDiv.appendChild(indicator);
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

export function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
        indicator.remove();
    }
}

export function updateReadingStatus(sentence, isPlaying) {
    const statusDiv = document.getElementById('readingStatus');
    const preview = document.getElementById('currentSentencePreview');
    const playPauseBtn = document.getElementById('readingPlayPauseBtn');

    if (sentence) {
        const shortSentence = sentence.substring(0, 80) + (sentence.length > 80 ? '...' : '');
        preview.textContent = shortSentence;
        statusDiv.classList.remove('hidden');
        if (playPauseBtn) {
            playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
            playPauseBtn.title = isPlaying ? 'Pause' : 'Resume';
            playPauseBtn.classList.toggle('paused', !isPlaying);
        }
    } else {
        statusDiv.classList.add('hidden');
    }
}

export function clearChat() {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = `
        <div class="chat-empty-state">
            <div class="icon">💬</div>
            <h3>Start a conversation</h3>
            <p>Click "Start Reading" to begin, or ask me any question about the paper!</p>
        </div>
    `;
}
