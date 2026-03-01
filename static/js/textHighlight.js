import { state } from './config.js';

// Store text content and positions for each page
state.pageTextContent = {};
state.currentHighlightedSpans = [];

/**
 * Split text into tokens (words + whitespace) for finer highlight granularity.
 * Preserves layout while enabling word-level highlighting.
 */
function splitIntoTokens(str) {
    if (!str || !str.length) return [];
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        const isSpace = /\s/.test(str[i]);
        let j = i + 1;
        if (isSpace) {
            while (j < str.length && /\s/.test(str[j])) j++;
        } else {
            while (j < str.length && !/\s/.test(str[j])) j++;
        }
        tokens.push(str.slice(i, j));
        i = j;
    }
    return tokens.filter(t => t.length > 0);
}

export async function renderTextLayer(page, viewport) {
    const textLayerEl = document.getElementById('textLayer');
    if (!textLayerEl) return;

    textLayerEl.innerHTML = '';
    textLayerEl.style.width = viewport.width + 'px';
    textLayerEl.style.height = viewport.height + 'px';

    try {
        // Get text content for our sentence matching
        const textContent = await page.getTextContent();
        state.pageTextContent[state.pageNum] = textContent;

        // Use PDF.js renderTextLayer with streamTextContent (correct v3 API)
        const textDivs = [];
        const renderTask = pdfjsLib.renderTextLayer({
            textContentSource: page.streamTextContent(),
            container: textLayerEl,
            viewport,
            textDivs,
        });
        await renderTask.promise;

        // Post-process: add our classes for word-level highlighting
        textDivs.forEach((div, index) => {
            const str = div.textContent;
            if (!str || !str.trim()) return;

            div.classList.add('text-item');

            const tokens = splitIntoTokens(str);
            div.textContent = '';

            tokens.forEach((token) => {
                const span = document.createElement('span');
                span.className = 'text-token';
                span.textContent = token;
                if (/\S/.test(token)) {
                    span.addEventListener('click', (e) => {
                        e.stopPropagation();
                        handleTextClick(e, str, index);
                    });
                }
                div.appendChild(span);
            });
        });

    } catch (err) {
        console.error('Text layer error:', err);
    }
}

function handleTextClick(event, text, index) {
    event.stopPropagation();
    const sentence = findSentenceFromText(text);
    if (sentence) {
        import('./textHighlight.js').then((module) => {
            module.highlightSentence(sentence);
        });
    }
}

function findSentenceFromText(clickedText) {
    const textContent = state.pageTextContent[state.pageNum];
    if (!textContent) return null;

    const fullText = textContent.items.map((item) => item.str).join(' ');
    const sentences = fullText.split(/[.!?]+/).filter((s) => s.trim().length > 20);

    for (const sentence of sentences) {
        if (sentence.includes(clickedText)) return sentence.trim();
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

/**
 * Find the minimal contiguous range of tokens that contains the search text.
 * Uses character-level mapping for precise highlighting.
 */
function findTokenRange(tokens, searchNorm) {
    let fullNorm = '';
    const ranges = [];
    for (const t of tokens) {
        const start = fullNorm.length;
        let norm = normalizeForMatch(t);
        if (fullNorm.endsWith('-')) {
            fullNorm = fullNorm.slice(0, -1) + norm;
        } else {
            fullNorm += (fullNorm ? ' ' : '') + norm;
        }
        ranges.push({ start, end: fullNorm.length });
    }

    let matchStart = fullNorm.indexOf(searchNorm);
    let matchLen = searchNorm.length;

    if (matchStart < 0 && searchNorm.length > 40) {
        matchStart = fullNorm.indexOf(searchNorm.substring(0, 60));
        matchLen = Math.min(60, searchNorm.length);
    }
    if (matchStart < 0 && searchNorm.length > 25) {
        matchStart = fullNorm.indexOf(searchNorm.substring(0, 40));
        matchLen = Math.min(40, searchNorm.length);
    }
    if (matchStart < 0) return [];

    const matchEnd = matchStart + matchLen;
    const result = [];
    ranges.forEach((r, i) => {
        if (r.end > matchStart && r.start < matchEnd) result.push(i);
    });
    return result;
}

export function highlightSentence(sentenceText) {
    clearHighlights();
    if (!sentenceText) return;

    const textLayer = document.getElementById('textLayer');
    if (!textLayer) return;

    const allTokens = Array.from(textLayer.querySelectorAll('.text-token'));
    if (allTokens.length === 0) return;

    const tokenTexts = allTokens.map((t) => t.textContent);

    // Try progressively shorter prefixes until we get a match.
    // Shorter prefix = tighter highlight region (avoids huge block highlighting).
    const prefixLengths = [80, 60, 50, 40, 30];
    let indices = [];
    for (const len of prefixLengths) {
        const prefix = normalizeForMatch(sentenceText.substring(0, len));
        if (prefix.length < 15) continue;
        indices = findTokenRange(tokenTexts, prefix);
        if (indices.length > 0) break;
    }

    // Last-resort: match first few significant words
    if (indices.length === 0) {
        const words = normalizeForMatch(sentenceText).split(/\s+/).filter(w => w.length > 3);
        const anchor = words.slice(0, 5).join(' ');
        if (anchor) indices = findTokenRange(tokenTexts, anchor);
    }

    const highlightedSpans = [];
    indices.forEach((i) => {
        allTokens[i].classList.add('highlight');
        highlightedSpans.push(allTokens[i]);
    });

    state.currentHighlightedSpans = highlightedSpans;
    if (highlightedSpans.length > 0) {
        highlightedSpans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

export function highlightWord(wordText) {
    const textLayer = document.getElementById('textLayer');
    if (!textLayer) return;

    textLayer.querySelectorAll('.highlight-word').forEach((s) => s.classList.remove('highlight-word'));
    if (!wordText) return;

    const wordLower = wordText.toLowerCase().trim();
    textLayer.querySelectorAll('.text-token').forEach((span) => {
        const t = span.textContent.toLowerCase().trim();
        if (t === wordLower || t.includes(wordLower)) {
            span.classList.add('highlight-word');
        }
    });
}

/** Highlight the word at wordIndex within the current sentence (Speechify-style current-word emphasis) */
export function highlightCurrentWordInSentence(sentenceText, wordIndex) {
    const textLayer = document.getElementById('textLayer');
    if (!textLayer) return;

    textLayer.querySelectorAll('.highlight-word').forEach((s) => s.classList.remove('highlight-word'));
    if (!sentenceText || wordIndex < 0) return;

    const highlightedSpans = Array.from(textLayer.querySelectorAll('.text-token.highlight'));
    if (highlightedSpans.length === 0) return;

    let wordCount = 0;
    for (const span of highlightedSpans) {
        const t = span.textContent.trim();
        if (t && /\S/.test(t)) {
            if (wordCount === wordIndex) {
                span.classList.add('highlight-word');
                span.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                return;
            }
            wordCount++;
        }
    }
}

export function clearHighlights() {
    state.currentHighlightedSpans.forEach((span) => {
        span.classList.remove('highlight');
        span.classList.remove('highlight-word');
    });
    state.currentHighlightedSpans = [];
}

export function clearWordHighlights() {
    const textLayer = document.getElementById('textLayer');
    if (textLayer) {
        textLayer.querySelectorAll('.highlight-word').forEach((s) => s.classList.remove('highlight-word'));
    }
}
