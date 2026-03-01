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
    textLayerEl.style.width  = viewport.width  + 'px';
    textLayerEl.style.height = viewport.height + 'px';
    // PDF.js 3.x uses this CSS variable internally for span positioning
    textLayerEl.style.setProperty('--scale-factor', viewport.scale);

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

        // Stamp each div with its PDF coordinate so highlightSentence can sort
        // by the actual document coordinate system (reliable reading order) instead
        // of relying on getBoundingClientRect which is affected by scroll/transforms.
        // PDF Y axis increases upward: larger transform[5] = higher on the page.
        textContent.items.forEach((item, i) => {
            if (textDivs[i] && Array.isArray(item.transform)) {
                textDivs[i].dataset.pdfX = item.transform[4].toFixed(2);
                textDivs[i].dataset.pdfY = item.transform[5].toFixed(2);
            }
        });

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
 *
 * tokens must be word-only (no whitespace entries) — whitespace tokens
 * normalise to "" and would create double spaces in fullNorm, making
 * indexOf fail for any single-spaced search string.
 */
function findTokenRange(tokens, searchNorm) {
    let fullNorm = '';
    const ranges = [];
    for (const t of tokens) {
        const norm = normalizeForMatch(t);
        // Skip tokens that are purely whitespace — they produce "" after
        // normalisation and would otherwise insert a double space.
        if (!norm) {
            ranges.push({ start: fullNorm.length, end: fullNorm.length });
            continue;
        }
        const start = fullNorm.length;
        if (fullNorm.endsWith('-')) {
            // Hyphenated word split across items — join without space
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

    if (!sentenceText) {
        console.warn('[HL] highlightSentence: no sentenceText');
        return;
    }
    console.log('[HL] highlightSentence called, text:', sentenceText.substring(0, 60));

    const textLayer = document.getElementById('textLayer');
    if (!textLayer) {
        console.warn('[HL] highlightSentence: no #textLayer in DOM');
        return;
    }

    // Sort text-item divs by PDF document coordinates (stamped during renderTextLayer).
    // PDF Y increases upward, so larger pdfY = higher on the page (top of page first).
    // This gives true visual reading order regardless of PDF content-stream order.
    // Same-line threshold: items within 3 PDF points share a line (typical line height
    // is 10–14 pt, so 3 pt cleanly separates lines without merging adjacent ones).
    const LINE_Y_PT = 3;
    const sortedItems = Array.from(textLayer.querySelectorAll('.text-item'))
        .filter(div => div.dataset.pdfY !== undefined)
        .sort((a, b) => {
            const ay = parseFloat(a.dataset.pdfY), by = parseFloat(b.dataset.pdfY);
            const dy = by - ay; // larger Y = higher on page
            if (Math.abs(dy) > LINE_Y_PT) return -dy;            // top → bottom
            return parseFloat(a.dataset.pdfX) - parseFloat(b.dataset.pdfX); // left → right
        });

    // Collect non-whitespace tokens in visual reading order from each sorted item
    const wordTokens = [];
    sortedItems.forEach(div => {
        div.querySelectorAll('.text-token').forEach(t => {
            if (/\S/.test(t.textContent)) wordTokens.push(t);
        });
    });

    console.log('[HL] wordTokens:', wordTokens.length,
        '| sample:', wordTokens.slice(0, 5).map(t => JSON.stringify(t.textContent)).join(', '));

    if (wordTokens.length === 0) {
        console.warn('[HL] highlightSentence: textLayer has no word tokens yet (no data-pdf-y attrs?)');
        return;
    }

    const tokenTexts = wordTokens.map((t) => t.textContent);

    // Try progressively shorter prefixes until we get a match.
    // Shorter prefix = tighter highlight region (avoids huge block highlighting).
    const prefixLengths = [80, 60, 50, 40, 30];
    let indices = [];
    for (const len of prefixLengths) {
        const prefix = normalizeForMatch(sentenceText.substring(0, len));
        if (prefix.length < 15) continue;
        indices = findTokenRange(tokenTexts, prefix);
        console.log('[HL] prefix len', len, '→ norm:', JSON.stringify(prefix.substring(0, 40)),
            '| indices found:', indices.length);
        if (indices.length > 0) break;
    }

    // Last-resort: match first few significant words
    if (indices.length === 0) {
        const words = normalizeForMatch(sentenceText).split(/\s+/).filter(w => w.length > 3);
        const anchor = words.slice(0, 5).join(' ');
        console.log('[HL] last-resort anchor:', JSON.stringify(anchor));
        if (anchor) indices = findTokenRange(tokenTexts, anchor);
        console.log('[HL] last-resort indices:', indices.length);
    }

    if (indices.length === 0) {
        console.warn('[HL] no match found — dumping first 20 token texts vs search:',
            tokenTexts.slice(0, 20));
        return;
    }

    const highlightedSpans = [];
    indices.forEach((i) => {
        wordTokens[i].classList.add('highlight');
        highlightedSpans.push(wordTokens[i]);
    });

    console.log('[HL] applied .highlight to', highlightedSpans.length, 'spans');
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

    // Sort highlighted spans using their parent div's PDF coordinates (same logic as
    // highlightSentence) so word-index counting matches visual reading order.
    const LINE_Y_PT = 3;
    const highlightedSpans = Array.from(textLayer.querySelectorAll('.text-token.highlight'))
        .sort((a, b) => {
            const pa = a.closest('.text-item'), pb = b.closest('.text-item');
            if (!pa || !pb) return 0;
            const ay = parseFloat(pa.dataset.pdfY || 0), by = parseFloat(pb.dataset.pdfY || 0);
            const dy = by - ay;
            if (Math.abs(dy) > LINE_Y_PT) return -dy;
            const ax = parseFloat(pa.dataset.pdfX || 0), bx = parseFloat(pb.dataset.pdfX || 0);
            if (ax !== bx) return ax - bx;
            // Same text-item: preserve DOM order
            const spans = Array.from(pa.querySelectorAll('.text-token'));
            return spans.indexOf(a) - spans.indexOf(b);
        });
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
