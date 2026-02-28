import { state } from './config.js';

// PDF.js setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export function renderPage(num) {
    state.pageRendering = true;
    state.pdfDoc.getPage(num).then(function(page) {
        const canvas = document.getElementById('pdfCanvas');
        const ctx = canvas.getContext('2d');
        const viewport = page.getViewport({scale: state.scale});

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };

        const renderTask = page.render(renderContext);
        renderTask.promise.then(function() {
            state.pageRendering = false;
            if (state.pageNumPending !== null) {
                renderPage(state.pageNumPending);
                state.pageNumPending = null;
            }
        });
    });

    document.getElementById('pageNum').textContent = num;
}

export function queueRenderPage(num) {
    if (state.pageRendering) {
        state.pageNumPending = num;
    } else {
        renderPage(num);
    }
}

export function previousPage() {
    if (state.pageNum <= 1) {
        return;
    }
    state.pageNum--;
    queueRenderPage(state.pageNum);
}

export function nextPage() {
    if (state.pageNum >= state.pdfDoc.numPages) {
        return;
    }
    state.pageNum++;
    queueRenderPage(state.pageNum);
}

export async function loadPDF(file) {
    const fileReader = new FileReader();
    
    return new Promise((resolve, reject) => {
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            
            try {
                state.pdfDoc = await pdfjsLib.getDocument(typedarray).promise;
                document.getElementById('pageCount').textContent = state.pdfDoc.numPages;
                
                // Render first page
                renderPage(state.pageNum);
                
                // Show PDF viewer
                document.getElementById('pdfViewerContainer').classList.add('active');
                
                resolve();
            } catch (error) {
                reject(error);
            }
        };
        
        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(file);
    });
}

export function updatePDFPosition(position) {
    // Auto-scroll PDF to approximate position
    if (state.pdfDoc && state.pdfDoc.numPages > 1 && state.totalSentences) {
        const progressPercent = position / state.totalSentences;
        
        // Calculate which page we should be on
        const estimatedPage = Math.max(1, Math.ceil(progressPercent * state.pdfDoc.numPages));
        
        // Only change page if we're significantly off
        if (Math.abs(estimatedPage - state.pageNum) > 1) {
            state.pageNum = Math.max(1, Math.min(estimatedPage, state.pdfDoc.numPages));
            queueRenderPage(state.pageNum);
        }
    }
}

export function showReadingIndicator() {
    document.getElementById('readingIndicator').classList.remove('hidden');
}

export function hideReadingIndicator() {
    document.getElementById('readingIndicator').classList.add('hidden');
}

export function jumpToPage(pageNumber) {
    if (state.pdfDoc && pageNumber >= 1 && pageNumber <= state.pdfDoc.numPages) {
        state.pageNum = pageNumber;
        queueRenderPage(pageNumber);
        
        // Scroll to top of PDF viewer
        const pdfWrapper = document.querySelector('.pdf-canvas-wrapper');
        if (pdfWrapper) {
            pdfWrapper.scrollTop = 0;
        }
    }
}
