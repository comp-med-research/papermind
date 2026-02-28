import { API_URL, state } from './config.js';
import { loadPDF } from './pdfViewer.js';

export async function uploadPDF(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', state.sessionId);

    document.getElementById('uploadStatus').classList.remove('hidden');

    try {
        // Load PDF for viewing
        await loadPDF(file);
        
        // Upload to backend
        const response = await fetch(`${API_URL}/upload?session_id=${state.sessionId}`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            // Store total sentences for progress calculation
            state.totalSentences = data.sentence_count;
            
            document.getElementById('uploadSection').style.display = 'none';
            document.getElementById('readingSection').classList.add('active');
        } else {
            alert('Error uploading PDF: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Error uploading PDF: ' + error.message);
    } finally {
        document.getElementById('uploadStatus').classList.add('hidden');
    }
}

export function goHome() {
    if (confirm('Are you sure you want to end this session? Your progress will be saved and you can resume later.')) {
        // Stop any playing audio
        if (state.currentAudio) {
            state.currentAudio.pause();
        }
        
        // Reset UI
        document.getElementById('uploadSection').style.display = 'block';
        document.getElementById('readingSection').classList.remove('active');
        document.getElementById('pdfViewerContainer').classList.remove('active');
        
        // Reset state
        state.isReading = false;
        state.pageNum = 1;
        
        // Reset buttons
        document.getElementById('startBtn').classList.remove('hidden');
        document.getElementById('pauseBtn').classList.add('hidden');
        document.getElementById('resumeBtn').classList.add('hidden');
        document.getElementById('questionSection').classList.remove('active');
        document.getElementById('answerDisplay').classList.add('hidden');
        
        // Clear file input
        document.getElementById('fileInput').value = '';
    }
}

export async function loadSessionSummary() {
    try {
        const response = await fetch(`${API_URL}/summary/${state.sessionId}`);
        const data = await response.json();
        if (!data.error) {
            updateStats(data);
        }
    } catch (error) {
        console.log('No existing session');
    }
}

export function updateStats(summary) {
    document.getElementById('statQuestions').textContent = summary.questions_asked || 0;
    document.getElementById('statProgress').textContent = summary.percent + '%';
    document.getElementById('progressFill').style.width = summary.percent + '%';
    
    // Store progress info for page calculation
    if (summary.progress) {
        const parts = summary.progress.split('/');
        if (parts.length === 2) {
            state.totalSentences = parseInt(parts[1]);
        }
    }
}
