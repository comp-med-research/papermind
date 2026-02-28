import { state } from './config.js';
import { jumpToPage } from './pdfViewer.js';

// Active response types
state.activeResponseTypes = ['text', 'voice'];

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
    bubble.textContent = content;
    
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

export function updateReadingStatus(sentence) {
    const statusDiv = document.getElementById('readingStatus');
    const preview = document.getElementById('currentSentencePreview');
    
    if (sentence) {
        const shortSentence = sentence.substring(0, 60) + (sentence.length > 60 ? '...' : '');
        preview.textContent = shortSentence;
        statusDiv.classList.remove('hidden');
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
