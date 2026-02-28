// Import all modules
import { state } from './config.js';
import { loadPDF, previousPage, nextPage, zoomIn, zoomOut, resetZoom } from './pdfViewer.js';
import { startReading, pauseReading, resumeReading } from './reading_chat.js';
import { uploadPDF, goHome, exportPodcast } from './session_chat.js';
import { sendMessage, handleVoiceInput, initChatInput } from './questions_chat.js';
import { toggleResponseType, clearChat } from './chat.js';
import { initSelectionContextMenu } from './selectionContextMenu.js';

// Expose functions globally for HTML onclick handlers
window.startReading = startReading;
window.pauseReading = pauseReading;
window.resumeReading = resumeReading;
window.goHome = goHome;
window.exportPodcast = exportPodcast;
window.toggleResponseType = toggleResponseType;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 PaperMind Chat Interface Loading...');
    
    initializeUploadHandlers();
    initializeChatHandlers();
    initializeKeyboardShortcuts();
    initializePanelResizer();
    initSelectionContextMenu();
    
    console.log('✅ PaperMind Chat Interface Ready!');
});

function initializePanelResizer() {
    const resizer = document.getElementById('panelResizer');
    const mainLayout = document.getElementById('mainLayout');
    if (!resizer || !mainLayout) return;

    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            const rect = mainLayout.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = Math.min(Math.max((x / rect.width) * 100, 20), 80);
            mainLayout.style.setProperty('--left-panel-size', pct + '%');
        }

        function onUp() {
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function initializeUploadHandlers() {
    const fileInput = document.getElementById('fileInput');
    
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file && file.type === 'application/pdf') {
                try {
                    // Upload to backend
                    await uploadPDF(file);
                    
                    // Load PDF in viewer
                    await loadPDF(file);
                    
                    // Switch to chat view
                    document.getElementById('uploadSection').classList.add('hidden');
                    document.getElementById('chatSection').classList.remove('hidden');
                    document.getElementById('pdfViewerContainer').classList.remove('hidden');
                    document.getElementById('panelResizer').classList.remove('hidden');
                    
                    console.log('✅ PDF loaded successfully');
                } catch (error) {
                    console.error('Error loading PDF:', error);
                    alert('Error loading PDF: ' + error.message);
                }
            }
        });
    }

    // PDF zoom and navigation controls
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const resetZoomBtn = document.getElementById('resetZoomBtn');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    if (zoomInBtn) zoomInBtn.addEventListener('click', zoomIn);
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', zoomOut);
    if (resetZoomBtn) resetZoomBtn.addEventListener('click', resetZoom);
    if (prevPageBtn) prevPageBtn.addEventListener('click', previousPage);
    if (nextPageBtn) nextPageBtn.addEventListener('click', nextPage);

    console.log('✅ Upload and PDF controls initialized');
}

function initializeChatHandlers() {
    const sendBtn = document.getElementById('sendBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const chatInput = document.getElementById('chatInput');
    
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    
    if (voiceBtn) {
        voiceBtn.addEventListener('click', handleVoiceInput);
    }
    
    // Initialize auto-resize and enter-to-send
    if (chatInput) {
        initChatInput();
    }
    
    console.log('✅ Chat handlers initialized');
}

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Space to pause/resume reading
        if (e.code === 'Space' && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (state.isReading) {
                pauseReading();
            } else if (state.sessionId) {
                resumeReading();
            }
        }
        
        // Arrow keys for page navigation
        if (e.code === 'ArrowLeft' && !e.target.matches('input, textarea')) {
            previousPage();
        }
        if (e.code === 'ArrowRight' && !e.target.matches('input, textarea')) {
            nextPage();
        }
        
        // +/- for zoom
        if ((e.code === 'Equal' || e.code === 'NumpadAdd') && !e.target.matches('input, textarea')) {
            zoomIn();
        }
        if ((e.code === 'Minus' || e.code === 'NumpadSubtract') && !e.target.matches('input, textarea')) {
            zoomOut();
        }
    });
    
    console.log('✅ Keyboard shortcuts initialized');
}

console.log('📚 PaperMind Chat Module Loaded');
