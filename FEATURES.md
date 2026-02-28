# PaperMind - Complete Feature List

## 🎯 Core Features

### 1. **PDF Reading with TTS**
- Upload research papers in PDF format
- Sentence-by-sentence reading with natural voice (Runware + ElevenLabs)
- Auto-advance to next sentence after audio completes
- Visual progress tracking

### 2. **ADHD-Optimized Interface**
- Clean, distraction-free design
- Large, easy-to-read text display
- Clear visual hierarchy
- Minimal cognitive load

### 3. **Split-Screen PDF Viewer**
- Live PDF display alongside reading controls
- Automatic page navigation based on reading progress
- Manual page controls (Previous/Next)
- Visual "Reading this section..." indicator
- Synchronized highlighting

## 🤖 AI-Powered Features

### 4. **Intelligent Orchestration (Nemotron)**
- Decides when to read, pause, or flag concepts
- Proactive concept flagging for recurring knowledge gaps
- Maintains reading position across interruptions
- Context-aware decision making

### 5. **RAG-Based Q&A with Source Citations** ⭐ NEW
**How it works:**
1. User asks a question (text or voice)
2. System retrieves relevant context from document
3. Nemotron generates answer grounded in document
4. **Sources are extracted and displayed** showing exact quotes used
5. User can verify the answer is truly grounded

**Example:**
```
Question: "What is p-value?"

Answer: A p-value measures the probability that your results 
occurred by chance. In this study, they used p < 0.05 as the 
threshold for statistical significance. Ready to continue?

📚 Sources from Document:
"We set statistical significance at p < 0.05"
"P-values were calculated using two-tailed t-tests"
"Results with p < 0.05 were considered statistically significant"
```

**Benefits:**
- ✅ Transparency - see exactly what informed the answer
- ✅ Trust - verify AI isn't hallucinating
- ✅ Learning - understand document structure
- ✅ Accountability - grounded in actual text

### 6. **Memory & Knowledge Gap Detection (Claude)**
- Tracks recurring question patterns
- Identifies knowledge gaps
- Proactively flags concepts you've struggled with before
- Builds long-term understanding profile

### 7. **Multimodal Responses**
Choose how you want answers delivered:
- **📝 Text** - Written explanation
- **🔊 Voice** - Audio narration (Runware TTS)
- **🖼️ Image** - Visual diagrams (Runware image generation)
- **🎥 Video** - Video explanations (future)

**Multiple formats simultaneously!** Get text + voice + image all at once.

## 🎤 Input Methods

### 8. **Voice Input (Speech Recognition)**
- Click microphone button to speak your question
- Automatic transcription to text
- Visual feedback while listening
- Works in Chrome, Edge, Safari
- Just like NotebookLM!

### 9. **Text Input**
- Traditional keyboard input
- Enter key to submit
- Auto-focus on question field

## 🔧 Session Management

### 10. **Session Persistence**
- Progress automatically saved
- Resume reading from exact position
- Question history maintained
- Knowledge gaps tracked across sessions

### 11. **Home/End Session**
- End session button with confirmation
- Return to upload screen
- Clean state reset
- Session data preserved for later

## 📊 Progress Tracking

### 12. **Real-Time Statistics**
- Sentences read counter
- Questions asked counter
- Progress percentage
- Visual progress bar

### 13. **Reading Position**
- Exact sentence tracking
- Context window for RAG
- Position preserved across interruptions
- PDF auto-scrolls to current position

## 🎨 Visual Features

### 14. **Reading Indicator**
- Animated indicator on PDF during reading
- Shows/hides based on reading state
- Pulse animation for attention
- Clear visual feedback

### 15. **Proactive Concept Flags**
- Yellow warning boxes for flagged concepts
- Appears before reading challenging sections
- Option to get refresher before continuing
- Based on previous question patterns

### 16. **Visual Explanations**
- AI-generated diagrams for complex concepts
- Clean, educational style
- Minimal, clear backgrounds
- Infographic-style illustrations

## 🏗️ Architecture

### Backend (FastAPI + Python)
- **Nemotron** (NVIDIA) - Orchestration & Q&A
- **Claude** (Anthropic) - Knowledge gap analysis
- **Runware** - TTS (ElevenLabs) + Image generation
- **PyMuPDF** - PDF parsing

### Frontend (Vanilla JS Modules)
- **PDF.js** - PDF rendering
- **Web Speech API** - Voice recognition
- **ES6 Modules** - Clean code organization
- **Responsive CSS** - Modern, accessible design

## 📁 Code Organization

```
papermind/
├── main.py                 # FastAPI backend
├── agents.py              # AI agents (Orchestrator, Conversation, Memory, Reading)
├── static/
│   ├── index.html         # Main UI (150 lines)
│   ├── css/
│   │   └── styles.css     # All styles (500 lines)
│   └── js/
│       ├── app.js         # Entry point
│       ├── config.js      # Global state
│       ├── pdfViewer.js   # PDF logic
│       ├── reading.js     # Reading logic
│       ├── questions.js   # Q&A + sources display
│       ├── session.js     # Session management
│       └── voiceInput.js  # Voice recognition
└── .env                   # API keys
```

## 🚀 Usage Flow

1. **Upload PDF** → Drag & drop or click to browse
2. **Start Reading** → Click play button
3. **Listen** → Audio plays automatically
4. **Ask Questions** → Type or speak (🎤)
5. **Select Response Types** → Choose text/voice/image/video
6. **View Answer + Sources** → See grounded response with citations
7. **Continue Reading** → Resume from exact position
8. **End Session** → Save progress and exit

## 🎯 Key Differentiators

1. **ADHD-First Design** - Built specifically for ADHD users
2. **Proactive Assistance** - Flags concepts before confusion
3. **Source Transparency** - Shows exact document quotes
4. **Multimodal Flexibility** - Choose your learning style
5. **Voice Everything** - Speak questions naturally
6. **True RAG** - Grounded answers with proof
7. **Memory Across Sessions** - Learns your knowledge gaps
8. **Split-Screen PDF** - See document while reading

## 🔮 Future Enhancements

- [ ] Video generation for complex concepts (Runware video API)
- [ ] Multiple PDF sessions/tabs
- [ ] Bookmarks and annotations
- [ ] Export session notes
- [ ] Dark mode
- [ ] Mobile app
- [ ] Collaborative reading sessions
- [ ] Integration with note-taking apps
- [ ] Custom voice selection
- [ ] Speed controls
- [ ] Highlight persistence on PDF
