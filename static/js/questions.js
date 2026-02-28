import { API_URL, state } from './config.js';
import { pauseReading, playAudio } from './reading.js';
import { updateStats } from './session.js';
import { startVoiceInput, getSelectedResponseTypes } from './voiceInput.js';

export function showQuestionInput() {
    pauseReading();
    document.getElementById('questionSection').classList.add('active');
    document.getElementById('questionInput').focus();
}

export function hideQuestionInput() {
    document.getElementById('questionSection').classList.remove('active');
    document.getElementById('questionInput').value = '';
}

export function handleVoiceInput() {
    startVoiceInput(
        (transcript) => {
            document.getElementById('questionInput').value = transcript;
        },
        (error) => {
            console.error('Voice input error:', error);
            alert('Voice input error: ' + error);
        }
    );
}

export async function submitQuestion() {
    const question = document.getElementById('questionInput').value.trim();
    
    if (!question) {
        alert('Please enter a question');
        return;
    }

    const responseTypes = getSelectedResponseTypes();
    
    if (responseTypes.length === 0) {
        alert('Please select at least one response type');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/interrupt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question: question,
                session_id: state.sessionId,
                response_types: responseTypes
            })
        });

        const data = await response.json();

        // Clear previous answer display
        clearAnswerDisplay();

        // Display text answer if requested
        if (responseTypes.includes('text') && data.answer) {
            document.getElementById('answerText').textContent = data.answer;
            document.getElementById('answerText').classList.remove('hidden');
        }

        // Display sources if available
        if (data.sources && data.sources.length > 0) {
            displaySources(data.sources);
        }

        // Display image if requested and available
        if (responseTypes.includes('image') && data.image_url) {
            const img = document.getElementById('visualImage');
            img.src = data.image_url;
            img.classList.remove('hidden');
        }

        // Display video if requested and available
        if (responseTypes.includes('video') && data.video_url) {
            const video = document.getElementById('visualVideo');
            video.src = data.video_url;
            video.classList.remove('hidden');
        }

        // Play voice answer if requested
        if (responseTypes.includes('voice') && data.audio_b64) {
            playAudio(data.audio_b64);
        }

        // Show answer display
        document.getElementById('answerDisplay').classList.remove('hidden');

        // Update stats
        if (data.summary) {
            updateStats(data.summary);
        }

        hideQuestionInput();

    } catch (error) {
        alert('Error submitting question: ' + error.message);
    }
}

function clearAnswerDisplay() {
    document.getElementById('answerText').textContent = '';
    document.getElementById('answerText').classList.add('hidden');
    document.getElementById('visualImage').classList.add('hidden');
    document.getElementById('visualVideo').classList.add('hidden');
    document.getElementById('sourcesSection').classList.add('hidden');
    document.getElementById('sourcesList').innerHTML = '';
}

function displaySources(sources) {
    const sourcesList = document.getElementById('sourcesList');
    const sourcesSection = document.getElementById('sourcesSection');
    
    // Clear previous sources
    sourcesList.innerHTML = '';
    
    // Add each source
    sources.forEach(source => {
        const sourceItem = document.createElement('div');
        sourceItem.className = 'source-item';
        
        // Handle both old format (string) and new format (object with page)
        const sourceText = typeof source === 'string' ? source : source.text;
        const sourcePage = typeof source === 'object' ? source.page : null;
        
        sourceItem.textContent = sourceText;
        
        // Add page badge if available
        if (sourcePage) {
            const pageBadge = document.createElement('span');
            pageBadge.className = 'source-page-badge';
            pageBadge.textContent = `Page ${sourcePage}`;
            sourceItem.appendChild(pageBadge);
            
            // Make clickable to jump to page
            sourceItem.style.cursor = 'pointer';
            sourceItem.title = `Click to view on page ${sourcePage}`;
            sourceItem.onclick = () => jumpToSourceInPDF(sourcePage, sourceText);
        }
        
        sourcesList.appendChild(sourceItem);
    });
    
    // Show sources section
    sourcesSection.classList.remove('hidden');
}

export function jumpToSourceInPDF(pageNumber, sourceText) {
    // Import from pdfViewer
    import('./pdfViewer.js').then(module => {
        module.jumpToPage(pageNumber);
        
        // Flash highlight effect
        const indicator = document.getElementById('readingIndicator');
        if (indicator) {
            indicator.textContent = `📍 Viewing: "${sourceText.substring(0, 50)}..."`;
            indicator.classList.remove('hidden');
            
            setTimeout(() => {
                indicator.textContent = '🎯 Reading this section...';
                indicator.classList.add('hidden');
            }, 3000);
        }
    });
}
