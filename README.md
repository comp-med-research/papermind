# PaperMind 📚

AI-Powered Reading Assistant for ADHD - Read research papers with intelligent voice narration, instant Q&A, and source citations.

## 🎯 Overview

PaperMind helps people with ADHD read and understand research papers by combining:
- **Sentence-by-sentence TTS** with natural voice (Runware + ElevenLabs)
- **Split-screen PDF viewer** with synchronized navigation
- **RAG-based Q&A** with clickable source citations
- **Multimodal responses** (text, voice, images)
- **Voice input** for hands-free questions
- **Proactive concept flagging** based on your knowledge gaps

## ✨ Key Features

### 1. **PDF Reading with TTS**
- Upload research papers in PDF format
- Sentence-by-sentence reading with natural voice
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

### 4. **Intelligent Orchestration (Nemotron)**
- Decides when to read, pause, or flag concepts
- Proactive concept flagging for recurring knowledge gaps
- Maintains reading position across interruptions
- Context-aware decision making

### 5. **RAG-Based Q&A with Clickable Source Citations** ⭐
**How it works:**
1. User asks a question (text or voice)
2. System retrieves relevant context from document
3. Nemotron generates answer grounded in document
4. Sources are extracted with page numbers
5. Click any source to jump to that page in the PDF

**Example:**
```
Question: "What is p-value?"

Answer: A p-value measures the probability that your results 
occurred by chance. In this study, they used p < 0.05 as the 
threshold for statistical significance. Ready to continue?

📚 Sources from Document:
┌─────────────────────────────────────────────────┐
│ "We set statistical significance at p < 0.05"   │
│                                         Page 3  │ ← Click to jump!
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ "P-values were calculated using two-tailed      │
│  t-tests"                                       │
│                                         Page 4  │ ← Click to jump!
└─────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ Transparency - see exactly what informed the answer
- ✅ Trust - verify AI isn't hallucinating
- ✅ Navigation - one-click jump to source location
- ✅ Learning - understand document structure

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

### 8. **Voice Input (Speech Recognition)**
- Click microphone button to speak your question
- Automatic transcription to text
- Visual feedback while listening
- Works in Chrome, Edge, Safari
- Just like NotebookLM!

### 9. **Session Management**
- Progress automatically saved
- Resume reading from exact position
- Question history maintained
- Knowledge gaps tracked across sessions
- End session button with confirmation

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

## 📁 Project Structure

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
├── .env                   # API keys
└── README.md             # This file
```

## 🚀 Getting Started

### Prerequisites
- Python 3.8+
- API keys for:
  - NVIDIA NIM (Nemotron)
  - Anthropic (Claude)
  - Runware

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd papermind
```

2. **Create virtual environment**
```bash
python -m venv papermind
source papermind/bin/activate  # On Windows: papermind\Scripts\activate
```

3. **Install dependencies**
```bash
pip install fastapi uvicorn python-dotenv anthropic openai pymupdf requests
```

4. **Set up environment variables**
Create a `.env` file:
```env
RUNWARE_API_KEY=your_runware_key
NEMOTRON_API_KEY=your_nvidia_key
NEMOTRON_BASE_URL=https://integrate.api.nvidia.com/v1
NEMOTRON_MODEL=nvidia/nemotron-3-nano
ANTHROPIC_API_KEY=your_anthropic_key
```

5. **Run the server**
```bash
uvicorn main:app --reload
```

6. **Open in browser**
Navigate to `http://localhost:8000`

## 📖 Usage Flow

1. **Upload PDF** → Drag & drop or click to browse
2. **Start Reading** → Click play button
3. **Listen** → Audio plays automatically
4. **Ask Questions** → Type or speak (🎤)
5. **Select Response Types** → Choose text/voice/image/video
6. **View Answer + Sources** → See grounded response with citations
7. **Click Sources** → Jump to exact page in PDF
8. **Continue Reading** → Resume from exact position
9. **End Session** → Save progress and exit

## 🎯 Key Differentiators

1. **ADHD-First Design** - Built specifically for ADHD users
2. **Proactive Assistance** - Flags concepts before confusion
3. **Source Transparency** - Shows exact document quotes with page numbers
4. **Multimodal Flexibility** - Choose your learning style
5. **Voice Everything** - Speak questions naturally
6. **True RAG** - Grounded answers with proof
7. **Memory Across Sessions** - Learns your knowledge gaps
8. **Split-Screen PDF** - See document while reading
9. **Clickable Citations** - One-click navigation to sources

## 🔧 Module Details

### Frontend Modules

#### `app.js`
- Main entry point
- Initializes all modules
- Sets up event listeners
- Exposes global functions

#### `config.js`
- Global state management
- API configuration
- Shared constants

#### `pdfViewer.js`
- PDF.js integration
- Page rendering
- Navigation controls
- Auto-scrolling to reading position

#### `reading.js`
- Start/pause/resume controls
- Audio playback
- Auto-advance logic
- Progress tracking

#### `questions.js`
- Q&A interface
- Multimodal response display
- Source citation rendering
- Clickable source navigation

#### `session.js`
- Session management
- PDF upload
- Progress persistence
- Statistics tracking

#### `voiceInput.js`
- Speech recognition
- Voice transcription
- Visual feedback

### Backend Agents

#### Orchestrator Agent
- Decides next action (READ, ANSWER, FLAG_CONCEPT)
- Maintains reading state
- Proactive concept flagging

#### Conversation Agent
- RAG-based Q&A
- Source extraction
- Visual prompt generation
- Context-aware responses

#### Memory Agent (Claude)
- Knowledge gap detection
- Pattern recognition
- Long-term learning profile

#### Reading Agent
- Sentence delivery
- Position tracking
- Proactive flag checking

## 🌐 Browser Compatibility

- **PDF Viewing**: All modern browsers (uses PDF.js)
- **Voice Input**: Chrome, Edge, Safari (WebKit Speech Recognition)
- **Audio Playback**: All modern browsers
- **ES6 Modules**: All modern browsers

## 🔮 Future Enhancements

- [ ] Video generation for complex concepts (Runware video API)
- [ ] Text highlighting on PDF canvas
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
- [ ] Offline mode with service workers

## 📊 Performance

- **TTS Latency**: ~500ms (Runware + ElevenLabs Flash v2.5)
- **Q&A Response**: ~2-3s (Nemotron + RAG)
- **PDF Rendering**: Instant (PDF.js)
- **Source Detection**: ~100ms per source

## 🤝 Contributing

Contributions are welcome! This project was built for a hackathon but is designed to be maintainable and extensible.

## 📄 License

[Your License Here]

## 🙏 Acknowledgments

- Built with [Nemotron](https://www.nvidia.com/en-us/ai/) by NVIDIA
- Powered by [Claude](https://www.anthropic.com/) by Anthropic
- TTS & Images by [Runware](https://runware.ai/)
- PDF rendering by [PDF.js](https://mozilla.github.io/pdf.js/)

---

**Made with ❤️ for people with ADHD**
