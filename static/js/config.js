// Configuration
export const API_URL = 'http://127.0.0.1:8000';

// Global state
export const state = {
    sessionId: 'default',
    currentAudio: null,
    isReading: false,
    pdfDoc: null,
    pageNum: 1,
    pageRendering: false,
    pageNumPending: null,
    scale: 1.5,
    totalSentences: 0,
    mediaRecorder: null,
    audioChunks: [],
    currentSentence: null,
    pageTextContent: {},
    currentHighlightedSpans: []
};
