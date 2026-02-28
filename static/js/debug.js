// Debug helper to check if functions are available
export function checkFunctions() {
    console.log('=== Function Availability Check ===');
    console.log('window.zoomIn:', typeof window.zoomIn);
    console.log('window.zoomOut:', typeof window.zoomOut);
    console.log('window.resetZoom:', typeof window.resetZoom);
    console.log('window.previousPage:', typeof window.previousPage);
    console.log('window.nextPage:', typeof window.nextPage);
    console.log('window.startReading:', typeof window.startReading);
    console.log('===================================');
}

// Auto-check on load
setTimeout(checkFunctions, 1000);
