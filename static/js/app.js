import { uploadPDF, goHome } from './session.js';
import { startReading, pauseReading, resumeReading } from './reading.js';
import { showQuestionInput, hideQuestionInput, submitQuestion, handleVoiceInput } from './questions.js';
import { previousPage, nextPage } from './pdfViewer.js';

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

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeUploadHandlers();
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
}
