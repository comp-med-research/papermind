# Source Navigation Feature

## 🎯 Overview

When you ask a question, PaperMind now shows you **exactly where** in the PDF the answer came from, and lets you **click to jump** to that location!

## ✨ How It Works

### 1. **Ask a Question**
```
User: "What is the sample size?"
```

### 2. **Get Answer with Sources**
```
💡 Answer
The study included 150 participants across three groups. 
Ready to continue?

📚 Sources from Document
┌─────────────────────────────────────────────────┐
│ "We recruited 150 participants"         Page 3  │  ← Clickable!
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ "Participants were divided into three groups"   │
│                                         Page 4  │  ← Clickable!
└─────────────────────────────────────────────────┘
```

### 3. **Click to Navigate**
- Click any source quote
- PDF automatically jumps to that page
- Visual indicator shows what you're viewing
- Text is highlighted (coming soon)

## 🔧 Technical Implementation

### Backend (`main.py`)

**1. Enhanced PDF Parsing**
```python
def pdf_to_sentences(pdf_bytes: bytes) -> tuple[list[str], str, dict]:
    """Parse PDF into sentences, full text, AND page mapping"""
    page_texts = {}  # page_num -> text content
    
    for page_num, page in enumerate(doc, start=1):
        page_text = page.get_text()
        page_texts[page_num] = page_text
    
    return sentences, full_text, page_texts
```

**2. Source Page Detection**
```python
def find_source_pages(sources: list[str], page_text_map: dict[int, str]) -> list[dict]:
    """Find which page each source quote appears on"""
    sources_with_pages = []
    
    for source in sources:
        for page_num, page_text in page_text_map.items():
            if source.lower() in page_text.lower():
                sources_with_pages.append({
                    "text": source,
                    "page": page_num
                })
                break
    
    return sources_with_pages
```

**3. Enhanced Response**
```python
# Before: sources = ["quote 1", "quote 2"]
# After:  sources = [
#   {"text": "quote 1", "page": 3},
#   {"text": "quote 2", "page": 4}
# ]
```

### Frontend (`questions.js` + `pdfViewer.js`)

**1. Clickable Source Display**
```javascript
function displaySources(sources) {
    sources.forEach(source => {
        const sourceItem = document.createElement('div');
        sourceItem.className = 'source-item';
        sourceItem.textContent = source.text;
        
        // Add page badge
        const pageBadge = document.createElement('span');
        pageBadge.className = 'source-page-badge';
        pageBadge.textContent = `Page ${source.page}`;
        sourceItem.appendChild(pageBadge);
        
        // Make clickable
        sourceItem.onclick = () => jumpToSourceInPDF(source.page, source.text);
    });
}
```

**2. PDF Navigation**
```javascript
export function jumpToPage(pageNumber) {
    state.pageNum = pageNumber;
    queueRenderPage(pageNumber);
    
    // Scroll to top
    pdfWrapper.scrollTop = 0;
}
```

**3. Visual Feedback**
```javascript
function jumpToSourceInPDF(pageNumber, sourceText) {
    jumpToPage(pageNumber);
    
    // Show indicator
    indicator.textContent = `📍 Viewing: "${sourceText.substring(0, 50)}..."`;
    indicator.classList.remove('hidden');
    
    // Hide after 3 seconds
    setTimeout(() => indicator.classList.add('hidden'), 3000);
}
```

## 🎨 Visual Design

### Source Item Styling
- **White background** with purple left border
- **Page badge** in top-right corner (purple)
- **Hover effect**: Slides right, changes color
- **Cursor**: Pointer to indicate clickability
- **Tooltip**: "Click to view on page X"

### Page Badge
```css
.source-page-badge {
    background: #667eea;
    color: white;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 0.75em;
    font-weight: 600;
}
```

### Hover Animation
```css
.source-item:hover {
    background: #f8f9ff;
    border-left-color: #764ba2;
    transform: translateX(5px);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}
```

## 🚀 User Experience Flow

1. **User asks question** → System retrieves context
2. **Answer generated** → Sources extracted with page numbers
3. **Sources displayed** → Each shows page badge
4. **User clicks source** → PDF jumps to that page
5. **Visual indicator** → Shows what's being viewed
6. **Auto-hide** → Indicator disappears after 3 seconds

## 📊 Benefits

### For Users
- ✅ **Verify answers** - See exact source in context
- ✅ **Quick navigation** - One click to relevant page
- ✅ **Build trust** - Transparent, grounded information
- ✅ **Learn faster** - Connect concepts to document structure

### For Learning
- ✅ **Context awareness** - See surrounding information
- ✅ **Document exploration** - Discover related content
- ✅ **Memory anchors** - Visual location helps retention
- ✅ **Active engagement** - Interactive learning experience

## 🔮 Future Enhancements

### Phase 2: Text Highlighting
- [ ] Extract exact coordinates of text on page
- [ ] Draw yellow highlight overlay on PDF
- [ ] Animate highlight appearance
- [ ] Persist highlights during session

### Phase 3: Advanced Features
- [ ] Multiple highlights for multiple sources
- [ ] Highlight intensity based on relevance
- [ ] Zoom to highlighted text
- [ ] Export highlighted sections
- [ ] Annotation support

## 📝 Example Session

```
1. Upload: "research_paper.pdf" (20 pages)

2. Ask: "What was the main finding?"

3. Response:
   Answer: "The study found a 40% improvement in retention..."
   
   Sources:
   - "retention improved by 40%" [Page 12] ← Click!
   - "compared to control group" [Page 13] ← Click!
   - "statistically significant (p<0.05)" [Page 14] ← Click!

4. Click "Page 12" → PDF jumps to page 12
   Indicator: "📍 Viewing: retention improved by 40%..."

5. Read context around the quote

6. Continue reading or ask another question
```

## 🎯 Key Features

- **Automatic page detection** - No manual tagging needed
- **Fast search** - Efficient text matching algorithm
- **Fallback handling** - Graceful if page not found
- **Visual feedback** - Clear indication of navigation
- **Smooth transitions** - Animated page changes
- **Context preservation** - Maintains reading state

## 💡 Tips for Best Results

1. **Ask specific questions** - More precise sources
2. **Click multiple sources** - Compare different pages
3. **Read surrounding text** - Get full context
4. **Use with voice** - Hands-free navigation
5. **Combine with images** - Visual + textual learning

---

This feature makes PaperMind truly transparent and interactive, turning passive reading into active exploration! 🚀
