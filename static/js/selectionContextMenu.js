import { API_URL, state } from './config.js';
import { addMessage, showTypingIndicator, hideTypingIndicator } from './chat.js';
import { playAudio } from './reading_chat.js';
import { renderQuizInChat } from './quiz.js';

let menuEl = null;

export function initSelectionContextMenu() {
    const textLayer = document.getElementById('textLayer');
    const pdfContainer = document.getElementById('pdfContainer');
    const container = textLayer || pdfContainer;
    if (!container) return;

    container.addEventListener('contextmenu', (e) => {
        const sel = window.getSelection();
        const selectedText = (sel && sel.toString() || '').trim();
        if (!selectedText || selectedText.length < 5) return;

        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY, selectedText);
    });

    document.addEventListener('click', () => hideMenu());
    document.addEventListener('scroll', () => hideMenu(), true);
}

function showMenu(x, y, selectedText) {
    hideMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'selection-context-menu';
    menuEl.innerHTML = `
        <button class="selection-menu-item" data-action="explain" data-type="text">📝 Explain with text</button>
        <button class="selection-menu-item" data-action="explain" data-type="audio">🔊 Explain with audio</button>
        <button class="selection-menu-item" data-action="explain" data-type="image">🖼️ Explain with picture</button>
        <button class="selection-menu-item" data-action="explain" data-type="video">🎥 Explain with video</button>
        <div class="selection-menu-divider"></div>
        <button class="selection-menu-item selection-menu-quiz" data-action="quiz">🧠 Quiz Me</button>
    `;

    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';

    menuEl.querySelectorAll('.selection-menu-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideMenu();
            if (btn.dataset.action === 'quiz') {
                quizSelection(selectedText);
            } else {
                explainSelection(selectedText, btn.dataset.type);
            }
        });
    });

    document.body.appendChild(menuEl);

    // Keep menu in viewport
    requestAnimationFrame(() => {
        const rect = menuEl.getBoundingClientRect();
        if (rect.right > window.innerWidth) menuEl.style.left = (window.innerWidth - rect.width - 8) + 'px';
        if (rect.bottom > window.innerHeight) menuEl.style.top = (window.innerHeight - rect.height - 8) + 'px';
    });
}

function hideMenu() {
    if (menuEl && menuEl.parentNode) {
        menuEl.parentNode.removeChild(menuEl);
        menuEl = null;
    }
}

async function quizSelection(selectedText) {
    const snippet = selectedText.substring(0, 80) + (selectedText.length > 80 ? '...' : '');
    addMessage('user', `Quiz me on: "${snippet}"`);
    showTypingIndicator();

    try {
        const res = await fetch(`${API_URL}/quiz-selection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                selected_text: selectedText,
                session_id: state.sessionId,
            }),
        });

        const data = await res.json();
        hideTypingIndicator();

        if (!res.ok || !data.questions) {
            addMessage('assistant', 'Sorry, could not generate quiz questions: ' + (data.error || res.status));
            return;
        }

        renderQuizInChat(data.questions);
    } catch (e) {
        hideTypingIndicator();
        addMessage('assistant', 'Error generating quiz: ' + e.message);
    }
}

async function explainSelection(selectedText, explainType) {
    addMessage('user', `Explain: "${selectedText.substring(0, 80)}${selectedText.length > 80 ? '...' : ''}"`);
    showTypingIndicator();

    try {
        const res = await fetch(`${API_URL}/explain-selection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                selected_text: selectedText,
                explain_type: explainType,
                session_id: state.sessionId,
            }),
        });

        const data = await res.json();
        hideTypingIndicator();

        if (!res.ok) {
            addMessage('assistant', 'Sorry, something went wrong: ' + (data.error || res.status));
            return;
        }

        const opts = { embeddingBackend: data.embedding_backend };
        if (data.image_url) opts.imageUrl = data.image_url;
        if (data.video_url) opts.videoUrl = data.video_url;

        addMessage('assistant', data.answer || 'No explanation generated.', opts);

        if (explainType === 'audio' && data.audio_base64) {
            playAudio(data.audio_base64);
        }
    } catch (e) {
        hideTypingIndicator();
        addMessage('assistant', 'Error: ' + e.message);
    }
}
