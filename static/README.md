# PaperMind Frontend Structure

## File Organization

```
static/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # All styles
└── js/
    ├── app.js          # Main application entry point
    ├── config.js       # Configuration and global state
    ├── pdfViewer.js    # PDF rendering and navigation
    ├── reading.js      # Reading functionality
    ├── questions.js    # Q&A and multimodal responses
    ├── session.js      # Session management
    └── voiceInput.js   # Voice recognition
```

## Features

### 1. Session Management
- **Home/End Session Button**: Users can end the current session and return to upload screen
- **Session Persistence**: Progress is saved and can be resumed later
- Located in: `js/session.js`

### 2. Voice Input
- **Speech Recognition**: Click the microphone button to ask questions with your voice
- **Browser Support**: Works in Chrome, Edge, and other Chromium-based browsers
- **Auto-transcription**: Spoken questions are automatically transcribed to text
- Located in: `js/voiceInput.js`

### 3. Multimodal Responses
Users can select how they want answers delivered:
- **📝 Text**: Written explanation (default)
- **🔊 Voice**: Audio narration of the answer (default)
- **🖼️ Image**: Visual diagram/illustration
- **🎥 Video**: Video explanation (future feature)

Multiple options can be selected simultaneously!
Located in: `js/questions.js`

### 4. Source Citations (RAG Transparency)
- **Grounded Answers**: All answers are grounded in the document using RAG
- **Source Quotes**: Shows exact quotes from the document that informed the answer
- **Transparency**: Users can verify the AI isn't hallucinating
- **Trust Building**: See exactly where information came from
- Sources are automatically extracted and displayed below each answer
Located in: `agents.py` (backend) and `js/questions.js` (frontend)

### 4. PDF Viewer
- **Split-screen layout**: PDF on left, controls on right
- **Auto-navigation**: Automatically scrolls to approximate reading position
- **Reading indicator**: Visual feedback showing active reading
- **Page controls**: Manual navigation with Previous/Next buttons
- Located in: `js/pdfViewer.js`

### 5. Reading Controls
- **Start/Pause/Resume**: Full control over reading flow
- **Auto-advance**: Automatically moves to next sentence after audio
- **Progress tracking**: Visual progress bar and statistics
- Located in: `js/reading.js`

## How It Works

### Initialization
1. `app.js` loads and initializes all modules
2. Event listeners are set up for drag-and-drop and file upload
3. Global functions are exposed for onclick handlers

### Upload Flow
1. User uploads PDF → `session.js::uploadPDF()`
2. PDF is loaded for viewing → `pdfViewer.js::loadPDF()`
3. PDF is sent to backend for processing
4. Session begins with sentence count stored

### Reading Flow
1. User clicks "Start Reading" → `reading.js::startReading()`
2. Backend returns sentence + audio
3. Audio plays automatically
4. PDF viewer shows reading indicator
5. On audio end, auto-advances to next sentence

### Question Flow
1. User clicks "Ask Question" → `questions.js::showQuestionInput()`
2. User types or speaks question
3. User selects response types (text/voice/image/video)
4. Question submitted → `questions.js::submitQuestion()`
5. Backend generates requested response types
6. All selected formats are displayed simultaneously

## Module Dependencies

```
app.js
├── session.js
│   ├── pdfViewer.js
│   └── config.js
├── reading.js
│   ├── pdfViewer.js
│   └── config.js
├── questions.js
│   ├── reading.js
│   ├── session.js
│   ├── voiceInput.js
│   └── config.js
└── pdfViewer.js
    └── config.js
```

## Browser Compatibility

- **PDF Viewing**: All modern browsers (uses PDF.js)
- **Voice Input**: Chrome, Edge, Safari (WebKit Speech Recognition)
- **Audio Playback**: All modern browsers
- **ES6 Modules**: All modern browsers

## Future Enhancements

- [ ] Video generation for complex concepts
- [ ] Offline mode with service workers
- [ ] Multiple PDF sessions
- [ ] Bookmarks and annotations
- [ ] Export session notes
- [ ] Dark mode
