function init(){

// Terminal state
let terminalContent = '';
let cursorPosition = 0; // Track cursor position in the content
const STORAGE_KEY = 'terminal_content';
const CURSOR_POS_KEY = 'terminal_cursor_pos';
let isUpdatingFromStorage = false;

// DOM elements
const textBeforeElement = document.getElementById('textBefore');
const textAfterElement = document.getElementById('textAfter');
const cursorElement = document.getElementById('cursor');
const terminalBody = document.getElementById('terminal');

// Initialize terminal with saved content
function initTerminal() {
    const savedContent = sessionStorage.getItem(STORAGE_KEY);
    const savedCursorPos = sessionStorage.getItem(CURSOR_POS_KEY);

    if (savedContent) {
        terminalContent = savedContent;
        cursorPosition = savedCursorPos ? parseInt(savedCursorPos) : terminalContent.length;
        // Ensure cursor position is valid
        cursorPosition = Math.max(0, Math.min(cursorPosition, terminalContent.length));
        renderContent(false); // Don't save back to storage on init
    }
    // Focus on the terminal
    terminalBody.focus();

    // Start polling for external changes
    startStorageSync();
}

// Render content to the terminal with cursor at position
function renderContent(saveToStorageFlag = true) {
    // Ensure cursor position is within bounds
    cursorPosition = Math.max(0, Math.min(cursorPosition, terminalContent.length));

    // Split content at cursor position
    const beforeCursor = terminalContent.substring(0, cursorPosition);
    const afterCursor = terminalContent.substring(cursorPosition);

    textBeforeElement.textContent = beforeCursor;
    textAfterElement.textContent = afterCursor;

    scrollToBottom();

    if (saveToStorageFlag) {
        saveToStorage();
    }
}

// Save content and cursor position to sessionStorage
function saveToStorage() {
    sessionStorage.setItem(STORAGE_KEY, terminalContent);
    sessionStorage.setItem(CURSOR_POS_KEY, cursorPosition.toString());
}

// Load content from sessionStorage
function loadFromStorage() {
    const savedContent = sessionStorage.getItem(STORAGE_KEY);
    const savedCursorPos = sessionStorage.getItem(CURSOR_POS_KEY);

    if (savedContent !== null && savedContent !== terminalContent) {
        isUpdatingFromStorage = true;
        terminalContent = savedContent;
        cursorPosition = savedCursorPos ? parseInt(savedCursorPos) : terminalContent.length;
        cursorPosition = Math.max(0, Math.min(cursorPosition, terminalContent.length));

        const beforeCursor = terminalContent.substring(0, cursorPosition);
        const afterCursor = terminalContent.substring(cursorPosition);

        textBeforeElement.textContent = beforeCursor;
        textAfterElement.textContent = afterCursor;

        scrollToBottom();
        isUpdatingFromStorage = false;
    }
}

// Clear terminal content
function clearTerminal() {
    terminalContent = '';
    cursorPosition = 0;
    renderContent();
}

// Clear sessionStorage
function clearStorage() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(CURSOR_POS_KEY);
    clearTerminal();
}

// Scroll to bottom of terminal
function scrollToBottom() {
    terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Bidirectional sync with sessionStorage
function startStorageSync() {
    // Poll for changes every 500ms
    setInterval(function () {
        if (!isUpdatingFromStorage) {
            loadFromStorage();
        }
    }, 500);
}

// Listen for storage events from other tabs/windows
window.addEventListener('storage', function (event) {
    if ((event.key === STORAGE_KEY || event.key === CURSOR_POS_KEY) && !isUpdatingFromStorage) {
        loadFromStorage();
    }
});

// Handle keyboard input
document.addEventListener('keydown', function (event) {
    // Allow certain key combinations to pass through
    if (event.ctrlKey || event.metaKey) {
        // Allow Ctrl+C, Ctrl+V, Ctrl+A, etc.
        if (!['c', 'v', 'a', 'x'].includes(event.key.toLowerCase())) {
            return;
        }
        if (event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'a') {
            return; // Allow copy and select all
        }
    }

    // Prevent default for keys we handle
    event.preventDefault();

    const key = event.key;

    switch (key) {
        case 'Backspace':
            if (cursorPosition > 0) {
                terminalContent = terminalContent.substring(0, cursorPosition - 1) +
                    terminalContent.substring(cursorPosition);
                cursorPosition--;
                renderContent();
            }
            break;

        case 'Delete':
            if (cursorPosition < terminalContent.length) {
                terminalContent = terminalContent.substring(0, cursorPosition) +
                    terminalContent.substring(cursorPosition + 1);
                renderContent();
            }
            break;

        case 'Enter':
            terminalContent = terminalContent.substring(0, cursorPosition) +
                '\n' +
                terminalContent.substring(cursorPosition);
            cursorPosition++;
            renderContent();
            break;

        case 'Tab':
            const tab = '    '; // 4 spaces for tab
            terminalContent = terminalContent.substring(0, cursorPosition) +
                tab +
                terminalContent.substring(cursorPosition);
            cursorPosition += tab.length;
            renderContent();
            break;

        case 'ArrowLeft':
            if (cursorPosition > 0) {
                cursorPosition--;
                renderContent();
            }
            break;

        case 'ArrowRight':
            if (cursorPosition < terminalContent.length) {
                cursorPosition++;
                renderContent();
            }
            break;

        case 'ArrowUp':
            // Move to start of current line or previous line
            const beforeCursor = terminalContent.substring(0, cursorPosition);
            const lastNewline = beforeCursor.lastIndexOf('\n', cursorPosition - 1);
            if (lastNewline !== -1) {
                const secondLastNewline = beforeCursor.lastIndexOf('\n', lastNewline - 1);
                const currentColumn = cursorPosition - lastNewline - 1;
                if (secondLastNewline !== -1) {
                    const prevLineLength = lastNewline - secondLastNewline - 1;
                    cursorPosition = secondLastNewline + 1 + Math.min(currentColumn, prevLineLength);
                } else {
                    cursorPosition = Math.min(currentColumn, lastNewline);
                }
                renderContent();
            } else {
                // Already on first line, go to start
                cursorPosition = 0;
                renderContent();
            }
            break;

        case 'ArrowDown':
            // Move to end of current line or next line
            const afterCursorText = terminalContent.substring(cursorPosition);
            const nextNewline = afterCursorText.indexOf('\n');
            if (nextNewline !== -1) {
                const beforeCursorText = terminalContent.substring(0, cursorPosition);
                const currentLineStart = beforeCursorText.lastIndexOf('\n') + 1;
                const currentColumn = cursorPosition - currentLineStart;

                const nextLineStart = cursorPosition + nextNewline + 1;
                const nextLineEnd = terminalContent.indexOf('\n', nextLineStart);
                const nextLineLength = nextLineEnd === -1 ?
                    terminalContent.length - nextLineStart :
                    nextLineEnd - nextLineStart;

                cursorPosition = nextLineStart + Math.min(currentColumn, nextLineLength);
                renderContent();
            } else {
                // Already on last line, go to end
                cursorPosition = terminalContent.length;
                renderContent();
            }
            break;

        case 'Home':
            // Move to start of current line
            const textBefore = terminalContent.substring(0, cursorPosition);
            const lineStart = textBefore.lastIndexOf('\n');
            cursorPosition = lineStart + 1;
            renderContent();
            break;

        case 'End':
            // Move to end of current line
            const textAfter = terminalContent.substring(cursorPosition);
            const lineEnd = textAfter.indexOf('\n');
            if (lineEnd === -1) {
                cursorPosition = terminalContent.length;
            } else {
                cursorPosition = cursorPosition + lineEnd;
            }
            renderContent();
            break;

        case 'Shift':
        case 'Control':
        case 'Alt':
        case 'Meta':
        case 'CapsLock':
        case 'Escape':
            // Ignore these keys
            break;

        default:
            // Add printable characters at cursor position
            if (key.length === 1) {
                terminalContent = terminalContent.substring(0, cursorPosition) +
                    key +
                    terminalContent.substring(cursorPosition);
                cursorPosition++;
                renderContent();
            }
            break;
    }
});

// Handle paste events
document.addEventListener('paste', function (event) {
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text');
    terminalContent = terminalContent.substring(0, cursorPosition) +
        pastedText +
        terminalContent.substring(cursorPosition);
    cursorPosition += pastedText.length;
    renderContent();
});

// Make terminal clickable to focus
terminalBody.addEventListener('click', function () {
    terminalBody.focus();
});

// Initialize on load
window.addEventListener('load', initTerminal);

// Helper function to get current content
function getTerminalContent() {
    return terminalContent;
}

// Helper function to get cursor position
function getCursorPosition() {
    return cursorPosition;
}

// Helper function to set cursor position
function setCursorPosition(pos) {
    cursorPosition = Math.max(0, Math.min(pos, terminalContent.length));
    renderContent();
}

// Helper function to set content programmatically
function setTerminalContent(content, moveCursorToEnd = true) {
    terminalContent = content;
    if (moveCursorToEnd) {
        cursorPosition = terminalContent.length;
    }
    renderContent();
}

// Helper function to append content
function appendToTerminal(text) {
    terminalContent += text;
    cursorPosition = terminalContent.length;
    renderContent();
}

// Helper function to insert at cursor
function insertAtCursor(text) {
    terminalContent = terminalContent.substring(0, cursorPosition) +
        text +
        terminalContent.substring(cursorPosition);
    cursorPosition += text.length;
    renderContent();
}

// Helper function to update sessionStorage directly
// Terminal will sync with this change automatically
function updateStorage(content, cursorPos = null) {
    sessionStorage.setItem(STORAGE_KEY, content);
    if (cursorPos !== null) {
        sessionStorage.setItem(CURSOR_POS_KEY, cursorPos.toString());
    }
    // Force immediate sync
    loadFromStorage();
}

// Helper function to force sync from storage
function syncFromStorage() {
    loadFromStorage();
}

// Make helper functions available globally
window.terminalHelpers = {
    getContent: getTerminalContent,
    getCursorPosition: getCursorPosition,
    setCursorPosition: setCursorPosition,
    setContent: setTerminalContent,
    append: appendToTerminal,
    insertAtCursor: insertAtCursor,
    clear: clearTerminal,
    clearStorage: clearStorage,
    updateStorage: updateStorage,
    syncFromStorage: syncFromStorage,
    getStorageKey: () => STORAGE_KEY,
    getCursorStorageKey: () => CURSOR_POS_KEY
};

}



window.addEventListener ?
window.addEventListener("load", init, false) :
window.attachEvent && window.attachEvent("onload", init);