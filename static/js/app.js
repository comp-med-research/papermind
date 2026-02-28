import { uploadPDF, goHome } from './session.js';
import { startReading, pauseReading, resumeReading } from './reading.js';
import { showQuestionInput, hideQuestionInput, submitQuestion, handleVoiceInput } from './questions.js';
import { previousPage, nextPage, zoomIn, zoomOut, resetZoom } from './pdfViewer.js';

// Make functions globally available for onclick handlers
window.uploadPDF = uploadPDF;
window.goHome = goHome;
window.startReading = startReading;
window.pauseReading = pauseReading;
window.resumeReading = resumeReading;
window.showQuestionInput = showQuestionInput;
window.hideQuestionInput = hideQuestionInput;
window.submitQuestion = submitQuestion;
window.handleVoiceInput = handleVoiceInput;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.resetZoom = resetZoom;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeUploadHandlers();
    initializeKeyboardShortcuts();
});

function initializeUploadHandlers() {
    const uploadSection = document.getElementById('uploadSection');
    const fileInput = document.getElementById('fileInput');
    
    // Drag and drop functionality
    uploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSection.classList.add('dragover');
    });

    uploadSection.addEventListener('dragleave', () => {
        uploadSection.classList.remove('dragover');
    });

    uploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSection.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            uploadPDF(file);
        } else {
            alert('Please upload a PDF file');
        }
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            uploadPDF(file);
        }
    });
    
    // Enter key to submit question
    document.getElementById('questionInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitQuestion();
        }
    });
    
    // Debug: Log when functions are attached
    console.log('Functions attached to window:', {
        zoomIn: typeof window.zoomIn,
        zoomOut: typeof window.zoomOut,
        resetZoom: typeof window.resetZoom
    });
}

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // Zoom shortcuts
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                zoomIn();
            } else if (e.key === '-') {
                e.preventDefault();
                zoomOut();
            } else if (e.key === '0') {
                e.preventDefault();
                resetZoom();
            }
        }
        
        // Page navigation shortcuts
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            previousPage();
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            nextPage();
        }
    });
}
