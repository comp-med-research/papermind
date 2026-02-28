import { state } from './config.js';

// Store text content and positions for each page
state.pageTextContent = {};
state.currentHighlightedSpans = [];

export async function renderTextLayer(page, viewport) {
    console.log('Rendering text layer for page', state.pageNum);
    const textLayer = document.getElementById('textLayer');
    
    if (!textLayer) {
        console.error('Text layer element not found!');
        return;
    }
    
    // Clear previous text layer
    textLayer.innerHTML = '';
    textLayer.style.width = viewport.width + 'px';
    textLayer.style.height = viewport.height + 'px';
    
    try {
        // Get text content from PDF
        const textContent = await page.getTextContent();
        console.log('Text content items:', textContent.items.length);
        
        // Store for later use
        state.pageTextContent[state.pageNum] = textContent;
        
        // Render each text item
        textContent.items.forEach((item, index) => {
            if (!item.str || item.str.trim().length === 0) return;
            
            const span = document.createElement('span');
            span.textContent = item.str;
            span.dataset.index = index;
            span.title = 'Click to start reading from here';
            
            // Calculate position and transform
            const tx = pdfjsLib.Util.transform(
                viewport.transform,
                item.transform
            );
            
            const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
            const fontAscent = fontHeight;
            
            span.style.left = tx[4] + 'px';
            span.style.top = (tx[5] - fontAscent) + 'px';
            span.style.fontSize = fontHeight + 'px';
            span.style.fontFamily = item.fontName;
            
            // Add click handler for click-to-start
            span.addEventListener('click', (e) => handleTextClick(e, item.str, index));
            
            textLayer.appendChild(span);
        });
        
        console.log('Text layer rendered with', textLayer.children.length, 'spans');
        
    } catch (error) {
        console.error('Error rendering text layer:', error);
    }
}

function handleTextClick(event, text, index) {
    event.stopPropagation();
    
    console.log('Clicked text:', text);
    
    // Find the sentence that contains this text
    const sentence = findSentenceFromText(text);
    
    if (sentence) {
        console.log('Found sentence:', sentence);
        // Highlight the clicked sentence
        import('./textHighlight.js').then(module => {
            module.highlightSentence(sentence);
        });
        
        // TODO: Implement backend endpoint to start from this sentence
        // For now, just highlight it
    }
}

function findSentenceFromText(clickedText) {
    // Get all text on current page
    const textContent = state.pageTextContent[state.pageNum];
    if (!textContent) return null;
    
    // Combine all text items
    const fullText = textContent.items.map(item => item.str).join(' ');
    
    // Find the sentence containing this text
    // Simple sentence detection (can be improved)
    const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    for (const sentence of sentences) {
        if (sentence.includes(clickedText)) {
            return sentence.trim();
        }
    }
    
    return null;
}

export function highlightSentence(sentenceText) {
    console.log('Highlighting sentence:', sentenceText);
    
    // Clear previous highlights
    clearHighlights();
    
    if (!sentenceText) {
        console.log('No sentence text provided');
        return;
    }
    
    const textLayer = document.getElementById('textLayer');
    if (!textLayer) {
        console.error('Text layer not found!');
        return;
    }
    
    const spans = textLayer.querySelectorAll('span');
    console.log('Found', spans.length, 'spans in text layer');
    
    if (spans.length === 0) {
        console.warn('No text spans found - text layer may not be rendered');
        return;
    }
    
    // More precise matching: find consecutive spans that match the sentence
    const sentenceClean = sentenceText.toLowerCase().trim();
    const sentenceWords = sentenceClean.split(/\s+/);
    const highlightedSpans = [];
    
    // Build text from spans to find exact match
    let currentText = '';
    let matchingSpans = [];
    
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        const spanText = span.textContent.trim();
        
        if (!spanText) continue;
        
        // Add to current text
        currentText += (currentText ? ' ' : '') + spanText;
        matchingSpans.push(span);
        
        // Check if current text contains the sentence
        const currentClean = currentText.toLowerCase().replace(/\s+/g, ' ').trim();
        
        // If we have a match, highlight these spans
        if (currentClean.includes(sentenceClean) || sentenceClean.includes(currentClean)) {
            // Found a match - highlight these spans
            matchingSpans.forEach(s => {
                s.classList.add('highlight');
                highlightedSpans.push(s);
            });
            break;
        }
        
        // If current text is getting too long and no match, reset
        if (matchingSpans.length > sentenceWords.length * 2) {
            // Remove oldest span and its text
            const removed = matchingSpans.shift();
            const removedText = removed.textContent.trim();
            currentText = currentText.substring(removedText.length).trim();
        }
    }
    
    // Fallback: if no exact match, try word-based matching (more conservative)
    if (highlightedSpans.length === 0) {
        console.log('Exact match failed, trying word-based matching');
        const firstWords = sentenceWords.slice(0, 3); // First 3 words
        const lastWords = sentenceWords.slice(-3); // Last 3 words
        
        let foundStart = false;
        let foundEnd = false;
        
        spans.forEach(span => {
            const spanText = span.textContent.toLowerCase().trim();
            
            // Start highlighting when we find the first words
            if (!foundStart && firstWords.some(word => spanText.includes(word))) {
                foundStart = true;
            }
            
            // Keep highlighting until we find the last words
            if (foundStart && !foundEnd) {
                span.classList.add('highlight');
                highlightedSpans.push(span);
                
                if (lastWords.some(word => spanText.includes(word))) {
                    foundEnd = true;
                }
            }
        });
    }
    
    console.log('Highlighted', highlightedSpans.length, 'spans');
    state.currentHighlightedSpans = highlightedSpans;
    
    // Scroll to first highlighted span
    if (highlightedSpans.length > 0) {
        highlightedSpans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

export function highlightWord(wordText) {
    // Remove word highlights only
    const textLayer = document.getElementById('textLayer');
    const spans = textLayer.querySelectorAll('span.highlight-word');
    spans.forEach(span => span.classList.remove('highlight-word'));
    
    if (!wordText) return;
    
    // Find and highlight the word
    const allSpans = textLayer.querySelectorAll('span');
    const wordLower = wordText.toLowerCase().trim();
    
    allSpans.forEach(span => {
        const spanText = span.textContent.toLowerCase().trim();
        if (spanText === wordLower || spanText.includes(wordLower)) {
            span.classList.add('highlight-word');
        }
    });
}

export function clearHighlights() {
    state.currentHighlightedSpans.forEach(span => {
        span.classList.remove('highlight');
        span.classList.remove('highlight-word');
    });
    state.currentHighlightedSpans = [];
}

export function clearWordHighlights() {
    const textLayer = document.getElementById('textLayer');
    const spans = textLayer.querySelectorAll('span.highlight-word');
    spans.forEach(span => span.classList.remove('highlight-word'));
}
