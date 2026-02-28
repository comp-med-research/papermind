import { API_URL, state } from './config.js';
import { loadPDF } from './pdfViewer.js';

export async function exportAudioOverview() {
    const btn = document.getElementById('exportPodcastBtn');
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Generating... (1–3 min)';

    try {
        const res = await fetch(`${API_URL}/export-podcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: state.sessionId,
                length: 'medium',
            }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Export failed (${res.status})`);
        }

        const mp3Bytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
        const blob = new Blob([mp3Bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        const player = document.getElementById('podcastPlayer');
        const audio = document.getElementById('podcastAudio');
        const downloadLink = document.getElementById('podcastDownload');
        const transcriptEl = document.getElementById('podcastTranscript');

        audio.src = url;
        downloadLink.href = url;
        downloadLink.download = 'papermind-audio-overview.mp3';
        transcriptEl.textContent = data.transcript || '';

        player.classList.remove('hidden');
        audio.play();
    } catch (e) {
        alert('Audio overview failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

export async function exportVideoOverview() {
    const btn = document.getElementById('exportVideoBtn');
    if (!btn) return;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Generating... (2–4 min)';

    try {
        const res = await fetch(`${API_URL}/export-video-overview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: state.sessionId }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Export failed (${res.status})`);
        }

        const videoUrl = data.video_url;
        if (!videoUrl) {
            throw new Error('No video generated');
        }

        const player = document.getElementById('videoOverviewPlayer');
        const video = document.getElementById('videoOverviewVideo');
        const downloadLink = document.getElementById('videoOverviewDownload');

        video.src = videoUrl;
        downloadLink.href = videoUrl;
        downloadLink.download = 'papermind-video-overview.mp4';

        player.classList.remove('hidden');
        video.play();
    } catch (e) {
        alert('Video overview failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

export async function uploadPDF(file) {
    const formData = new FormData();
    formData.append('file', file);

    const statusEl = document.getElementById('uploadStatus');
    if (statusEl) statusEl.classList.remove('hidden');

    try {
        const sessionId = state.sessionId || 'default';
        const base = (API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
        const url = `${base}/upload?session_id=${encodeURIComponent(sessionId)}`;
        console.log('📤 Uploading to:', url);
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.error('Upload failed:', response.status, data);
        }

        if (data.success) {
            state.totalSentences = data.sentence_count;
            console.log('✅ PDF uploaded successfully');
        } else {
            throw new Error(data.error || (data.detail && JSON.stringify(data.detail)) || 'Unknown error');
        }
    } catch (error) {
        throw error;
    } finally {
        if (statusEl) statusEl.classList.add('hidden');
    }
}

export function goHome() {
    if (confirm('End this session and return home?')) {
        // Stop any playing audio
        if (state.currentAudio) {
            state.currentAudio.pause();
        }
        
        // Clear chat
        import('./chat.js').then(module => {
            module.clearChat();
        });
        
        // Reset UI
        document.getElementById('uploadSection').classList.remove('hidden');
        document.getElementById('pdfViewerContainer').classList.add('hidden');
        document.getElementById('podcastPlayer').classList.add('hidden');
        document.getElementById('videoOverviewPlayer').classList.add('hidden');
        
        // Reset state
        state.sessionId = null;
        state.isReading = false;
        state.currentAudio = null;
        state.currentSentence = null;
        state.pdfDoc = null;
        state.pageNum = 1;
        
        // Reset play/pause button
        import('./reading_chat.js').then(m => { if (m.updatePlayPauseButton) m.updatePlayPauseButton(); });
        
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
    
    // Store progress info for page calculation
    if (summary.progress) {
        const parts = summary.progress.split('/');
        if (parts.length === 2) {
            state.totalSentences = parseInt(parts[1]);
        }
    }
}
