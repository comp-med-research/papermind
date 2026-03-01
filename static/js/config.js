// Configuration - use same origin when page is from backend to avoid localhost vs 127.0.0.1 CORS
export const API_URL = (typeof window !== 'undefined' && window.location.port === '8000') ? window.location.origin : 'http://127.0.0.1:8000';

// Global state
export const state = {
    sessionId: 'default',
    currentAudio: null,
    isReading: false,
    pdfDoc: null,
    pageNum: 1,
    pageRendering: false,
    pageNumPending: null,
    scale: 0.75,
    totalSentences: 0,
    mediaRecorder: null,
    audioChunks: [],
    currentSentence: null,
    pageTextContent: {},
    currentHighlightedSpans: [],
    pendingHighlightAfterRender: null  // Text to highlight after next page render (for source citations)
};
