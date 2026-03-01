// Import all modules
import { state } from './config.js';
import { loadPDF, previousPage, nextPage, zoomIn, zoomOut, resetZoom } from './pdfViewer.js';
import { startReading, pauseReading, resumeReading, togglePlayPause } from './reading_chat.js';
import { uploadPDF, goHome, deleteChat, exportAudioOverview, exportVideoOverview } from './session_chat.js';
import { sendMessage, handleVoiceInput, initChatInput } from './questions_chat.js';
import { toggleResponseType, clearChat } from './chat.js';
import { initSelectionContextMenu } from './selectionContextMenu.js';
import { initLiveTalk } from './liveTalk.js';

// Expose functions globally for HTML onclick handlers
window.togglePlayPause = togglePlayPause;
window.goHome = goHome;
window.deleteChat = deleteChat;
window.exportAudioOverview = exportAudioOverview;
window.exportVideoOverview = exportVideoOverview;
window.toggleResponseType = toggleResponseType;
window.togglePanel = togglePanel;
window.toggleTheme = toggleTheme;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 PaperMind Chat Interface Loading...');
    
    initializeUploadHandlers();
    initializeChatHandlers();
    initializeKeyboardShortcuts();
    initializePanelResizer();
    initSelectionContextMenu();
    initLiveTalk();
    initTheme();
    
    console.log('✅ PaperMind Chat Interface Ready!');
});

function initializePanelResizer() {
    const mainLayout = document.getElementById('mainLayout');
    const resizer1 = document.getElementById('resizer1');
    const resizer2 = document.getElementById('resizer2');
    if (!mainLayout || !resizer1 || !resizer2) return;

    resizer1.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer1.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        function onMove(e) {
            const rect = mainLayout.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * 100;
            const pct = Math.min(Math.max(x, 18), 55);
            mainLayout.style.setProperty('--sources-size', pct + '%');
        }
        function onUp() {
            resizer1.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    resizer2.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer2.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        function onMove(e) {
            const rect = mainLayout.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * 100;
            const studioPct = Math.min(Math.max(100 - x, 18), 55);
            mainLayout.style.setProperty('--studio-size', studioPct + '%');
        }
        function onUp() {
            resizer2.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

async function handleFileSelect(file) {
    const fileInput = document.getElementById('fileInput');
    if (!file || file.type !== 'application/pdf') {
        if (file) alert('Please select a PDF file');
        return;
    }
    try {
        await uploadPDF(file);
        await loadPDF(file);
        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('pdfViewerContainer').classList.remove('hidden');
        console.log('✅ PDF loaded successfully');
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF: ' + error.message);
    } finally {
        if (fileInput) fileInput.value = '';
    }
}

function initializeUploadHandlers() {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.querySelector('.upload-section');
    
    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target?.files?.[0];
            console.log('📄 File selected:', file?.name, file?.type);
            await handleFileSelect(file);
        });
    } else {
        console.error('❌ fileInput not found');
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
            const file = e.dataTransfer?.files[0];
            await handleFileSelect(file);
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
            if (state.sessionId) {
                togglePlayPause();
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

function togglePanel(panelId) {
    const panel = document.getElementById(panelId + 'Panel');
    const resizer = panelId === 'sources' ? document.getElementById('resizer1') : document.getElementById('resizer2');
    const btn = document.getElementById(panelId + 'CollapseBtn');
    if (!panel || !btn) return;

    const collapsed = panel.classList.toggle('collapsed');
    btn.textContent = collapsed ? '⊞' : '⊟';
    btn.title = collapsed ? 'Expand panel' : 'Collapse panel';
    if (resizer) resizer.style.display = collapsed ? 'none' : '';
}

function initTheme() {
    const saved = localStorage.getItem('pm-theme') || 'light';
    applyTheme(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pm-theme', theme);
    const sun  = document.getElementById('themeIconSun');
    const moon = document.getElementById('themeIconMoon');
    if (sun)  sun.style.display  = theme === 'dark'  ? 'none'  : '';
    if (moon) moon.style.display = theme === 'dark'  ? ''      : 'none';
}

console.log('📚 PaperMind Chat Module Loaded');
