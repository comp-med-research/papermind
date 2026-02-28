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

function normalizeForMatch(text) {
    return text
        .replace(/\*+/g, '')
        .replace(/^["']+|["']+$/g, '')
        .replace(/\.{2,}$/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .trim();
}

export function highlightSentence(sentenceText) {
    console.log('Highlighting sentence:', sentenceText);
    
    clearHighlights();
    if (!sentenceText) return;
    
    const textLayer = document.getElementById('textLayer');
    if (!textLayer) return;
    
    const spans = Array.from(textLayer.querySelectorAll('span'));
    if (spans.length === 0) return;
    
    const searchNormalized = normalizeForMatch(sentenceText);
    
    // Build normalized page text from spans + track char range per span
    let normFullText = '';
    const spanRanges = []; // { span, start, end } in normFullText
    
    for (const span of spans) {
        const t = span.textContent.trim();
        if (!t) continue;
        
        const start = normFullText.length;
        const normPart = normalizeForMatch(t);
        normFullText += (normFullText ? ' ' : '') + normPart;
        spanRanges.push({ span, start, end: normFullText.length });
    }
    
    // Find where search appears (try full, then first 60, then 40 chars - same as backend)
    let matchStart = normFullText.indexOf(searchNormalized);
    let matchLen = searchNormalized.length;
    if (matchStart < 0 && searchNormalized.length > 40) {
        matchStart = normFullText.indexOf(searchNormalized.substring(0, 60));
        matchLen = 60;
    }
    if (matchStart < 0 && searchNormalized.length > 30) {
        matchStart = normFullText.indexOf(searchNormalized.substring(0, 40));
        matchLen = 40;
    }
    
    const highlightedSpans = [];
    if (matchStart >= 0) {
        const matchEnd = matchStart + matchLen;
        spanRanges.forEach(({ span, start, end }) => {
            if (end > matchStart && start < matchEnd) {
                span.classList.add('highlight');
                highlightedSpans.push(span);
            }
        });
    }
    
    // Fallback: sliding window - find minimal consecutive spans containing search
    if (highlightedSpans.length === 0) {
        for (let i = 0; i < spans.length; i++) {
            let built = '';
            for (let j = i; j < Math.min(i + 25, spans.length); j++) {
                const t = spans[j].textContent.trim();
                if (!t) continue;
                built += (built ? ' ' : '') + t;
                const currNorm = normalizeForMatch(built);
                if (currNorm.includes(searchNormalized)) {
                    for (let k = i; k <= j; k++) {
                        const s = spans[k];
                        if (s.textContent.trim()) {
                            s.classList.add('highlight');
                            highlightedSpans.push(s);
                        }
                    }
                    break;
                }
            }
            if (highlightedSpans.length > 0) break;
        }
    }
    
    // Last resort: highlight by first/last significant words
    if (highlightedSpans.length === 0) {
        const words = searchNormalized.split(/\s+/).filter(w => w.length > 2);
        const firstWords = words.slice(0, 4);
        const lastWords = words.slice(-2);
        let inRange = false;
        let count = 0;
        const maxSpans = 20;
        for (const span of spans) {
            const t = span.textContent.toLowerCase().trim();
            if (!t) continue;
            if (!inRange && firstWords.some(w => t.includes(w))) inRange = true;
            if (inRange && count < maxSpans) {
                span.classList.add('highlight');
                highlightedSpans.push(span);
                count++;
                if (lastWords.some(w => t.includes(w))) inRange = false;
            }
        }
    }
    
    state.currentHighlightedSpans = highlightedSpans;
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
