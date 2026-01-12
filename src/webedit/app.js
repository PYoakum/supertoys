class MarkdownEditor {
    constructor(config) {
        this.config = config;
        this.content = '';
        this.cursorPosition = 0;
        this.fileId = null;
        this.isUpdatingFromStorage = false;
        this.autoSaveTimer = null;
        
        // DOM elements
        this.textBeforeElement = document.getElementById('textBefore');
        this.textAfterElement = document.getElementById('textAfter');
        this.cursorElement = document.getElementById('cursor');
        this.editorContent = document.getElementById('editorContent');
        this.previewContent = document.getElementById('previewContent');
        this.fileInfoElement = document.getElementById('fileInfo');
        
        this.init();
    }
    
    init() {
        this.applyStyling();
        this.loadFromStorage();
        this.setupEventListeners();
        this.startStorageSync();
        
        if (this.config.behavior.autoSave) {
            this.startAutoSave();
        }
        
        this.editorContent.focus();
    }
    
    applyStyling() {
        const root = document.documentElement;
        const c = this.config.colors;
        const t = this.config.typography;
        const l = this.config.layout;
        
        root.style.setProperty('--bg-color', c.background);
        root.style.setProperty('--editor-bg', c.editorBackground);
        root.style.setProperty('--preview-bg', c.previewBackground);
        root.style.setProperty('--text-color', c.text);
        root.style.setProperty('--cursor-color', c.cursor);
        root.style.setProperty('--menu-bg', c.menuBackground);
        root.style.setProperty('--menu-text', c.menuText);
        root.style.setProperty('--menu-hover', c.menuHover);
        root.style.setProperty('--border-color', c.border);
        root.style.setProperty('--scrollbar-color', c.scrollbar);
        root.style.setProperty('--scrollbar-hover', c.scrollbarHover);
        root.style.setProperty('--accent-primary', c.accentPrimary);
        root.style.setProperty('--accent-secondary', c.accentSecondary);
        root.style.setProperty('--button-bg', c.buttonBackground);
        root.style.setProperty('--button-hover', c.buttonHover);
        root.style.setProperty('--button-text', c.buttonText);
        
        root.style.setProperty('--editor-font-family', t.editorFontFamily);
        root.style.setProperty('--editor-font-size', t.editorFontSize);
        root.style.setProperty('--editor-line-height', t.editorLineHeight);
        root.style.setProperty('--preview-font-family', t.previewFontFamily);
        root.style.setProperty('--preview-font-size', t.previewFontSize);
        root.style.setProperty('--preview-line-height', t.previewLineHeight);
        
        root.style.setProperty('--menu-height', l.menuHeight);
        root.style.setProperty('--split-ratio', l.splitRatio);
        root.style.setProperty('--padding', l.padding);
        root.style.setProperty('--border-radius', l.borderRadius);
        root.style.setProperty('--max-width', l.maxWidth);
    }
    
    setupEventListeners() {
        // Keyboard input
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('paste', (e) => this.handlePaste(e));
        
        // Editor focus
        this.editorContent.addEventListener('click', () => this.editorContent.focus());
        
        // Menu buttons
        document.getElementById('exportBtn').addEventListener('click', () => this.exportMarkdown());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveToAPI());
        document.getElementById('clearBtn').addEventListener('click', () => this.clearContent());
        document.getElementById('newBtn').addEventListener('click', () => this.newDocument());
        
        // Storage events from other tabs
        window.addEventListener('storage', (e) => {
            if ((e.key === this.config.storage.contentKey || 
                 e.key === this.config.storage.cursorKey) && 
                !this.isUpdatingFromStorage) {
                this.loadFromStorage();
            }
        });
    }
    
    handleKeyDown(event) {
        if (event.ctrlKey || event.metaKey) {
            // Allow Ctrl+S for save
            if (event.key.toLowerCase() === 's') {
                event.preventDefault();
                this.saveToAPI();
                return;
            }
            // Allow copy, paste, select all
            if (['c', 'v', 'a', 'x'].includes(event.key.toLowerCase())) {
                if (event.key.toLowerCase() !== 'v') return;
            }
        }
        
        event.preventDefault();
        
        const key = event.key;
        
        switch(key) {
            case 'Backspace':
                if (this.cursorPosition > 0) {
                    this.content = this.content.substring(0, this.cursorPosition - 1) + 
                                  this.content.substring(this.cursorPosition);
                    this.cursorPosition--;
                    this.render();
                }
                break;
                
            case 'Delete':
                if (this.cursorPosition < this.content.length) {
                    this.content = this.content.substring(0, this.cursorPosition) + 
                                  this.content.substring(this.cursorPosition + 1);
                    this.render();
                }
                break;
                
            case 'Enter':
                this.content = this.content.substring(0, this.cursorPosition) + 
                              '\n' + 
                              this.content.substring(this.cursorPosition);
                this.cursorPosition++;
                this.render();
                break;
                
            case 'Tab':
                const tab = ' '.repeat(this.config.behavior.tabSize);
                this.content = this.content.substring(0, this.cursorPosition) + 
                              tab + 
                              this.content.substring(this.cursorPosition);
                this.cursorPosition += tab.length;
                this.render();
                break;
                
            case 'ArrowLeft':
                if (this.cursorPosition > 0) {
                    this.cursorPosition--;
                    this.render();
                }
                break;
                
            case 'ArrowRight':
                if (this.cursorPosition < this.content.length) {
                    this.cursorPosition++;
                    this.render();
                }
                break;
                
            case 'ArrowUp':
                this.moveCursorUp();
                break;
                
            case 'ArrowDown':
                this.moveCursorDown();
                break;
                
            case 'Home':
                this.moveCursorToLineStart();
                break;
                
            case 'End':
                this.moveCursorToLineEnd();
                break;
                
            case 'Shift':
            case 'Control':
            case 'Alt':
            case 'Meta':
            case 'CapsLock':
            case 'Escape':
                break;
                
            default:
                if (key.length === 1) {
                    this.content = this.content.substring(0, this.cursorPosition) + 
                                  key + 
                                  this.content.substring(this.cursorPosition);
                    this.cursorPosition++;
                    this.render();
                }
                break;
        }
    }
    
    handlePaste(event) {
        event.preventDefault();
        const pastedText = event.clipboardData.getData('text');
        this.content = this.content.substring(0, this.cursorPosition) + 
                      pastedText + 
                      this.content.substring(this.cursorPosition);
        this.cursorPosition += pastedText.length;
        this.render();
    }
    
    moveCursorUp() {
        const beforeCursor = this.content.substring(0, this.cursorPosition);
        const lastNewline = beforeCursor.lastIndexOf('\n', this.cursorPosition - 1);
        
        if (lastNewline !== -1) {
            const secondLastNewline = beforeCursor.lastIndexOf('\n', lastNewline - 1);
            const currentColumn = this.cursorPosition - lastNewline - 1;
            
            if (secondLastNewline !== -1) {
                const prevLineLength = lastNewline - secondLastNewline - 1;
                this.cursorPosition = secondLastNewline + 1 + Math.min(currentColumn, prevLineLength);
            } else {
                this.cursorPosition = Math.min(currentColumn, lastNewline);
            }
            this.render();
        } else {
            this.cursorPosition = 0;
            this.render();
        }
    }
    
    moveCursorDown() {
        const afterCursor = this.content.substring(this.cursorPosition);
        const nextNewline = afterCursor.indexOf('\n');
        
        if (nextNewline !== -1) {
            const beforeCursor = this.content.substring(0, this.cursorPosition);
            const currentLineStart = beforeCursor.lastIndexOf('\n') + 1;
            const currentColumn = this.cursorPosition - currentLineStart;
            
            const nextLineStart = this.cursorPosition + nextNewline + 1;
            const nextLineEnd = this.content.indexOf('\n', nextLineStart);
            const nextLineLength = nextLineEnd === -1 ? 
                this.content.length - nextLineStart : 
                nextLineEnd - nextLineStart;
            
            this.cursorPosition = nextLineStart + Math.min(currentColumn, nextLineLength);
            this.render();
        } else {
            this.cursorPosition = this.content.length;
            this.render();
        }
    }
    
    moveCursorToLineStart() {
        const beforeCursor = this.content.substring(0, this.cursorPosition);
        const lineStart = beforeCursor.lastIndexOf('\n');
        this.cursorPosition = lineStart + 1;
        this.render();
    }
    
    moveCursorToLineEnd() {
        const afterCursor = this.content.substring(this.cursorPosition);
        const lineEnd = afterCursor.indexOf('\n');
        
        if (lineEnd === -1) {
            this.cursorPosition = this.content.length;
        } else {
            this.cursorPosition = this.cursorPosition + lineEnd;
        }
        this.render();
    }
    
    render() {
        this.cursorPosition = Math.max(0, Math.min(this.cursorPosition, this.content.length));
        
        const beforeCursor = this.content.substring(0, this.cursorPosition);
        const afterCursor = this.content.substring(this.cursorPosition);
        
        this.textBeforeElement.textContent = beforeCursor;
        this.textAfterElement.textContent = afterCursor;
        
        if (this.config.behavior.livePreview) {
            this.updatePreview();
        }
        
        this.saveToStorage();
    }
    
    updatePreview() {
        const html = this.parseMarkdown(this.content);
        this.previewContent.innerHTML = html;
    }
    
    parseMarkdown(markdown) {
        let html = markdown;
        
        // Escape HTML
        html = html.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;');
        
        // Code blocks (must be before inline code)
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre><code>${code.trim()}</code></pre>`;
        });
        
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Headers
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
        
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');
        
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        
        // Images
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
        
        // Horizontal rules
        html = html.replace(/^(\*\*\*|---|___)$/gm, '<hr>');
        
        // Blockquotes
        html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
        
        // Lists (simple implementation)
        html = html.replace(/^\*\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/^-\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
        
        // Wrap consecutive <li> in <ul>
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
            return '<ul>' + match + '</ul>';
        });
        
        // Paragraphs
        html = html.split('\n\n').map(para => {
            para = para.trim();
            if (!para.match(/^<(h[1-6]|ul|ol|pre|blockquote|hr)/)) {
                return para ? `<p>${para}</p>` : '';
            }
            return para;
        }).join('\n');
        
        return html;
    }
    
    saveToStorage() {
        sessionStorage.setItem(this.config.storage.contentKey, this.content);
        sessionStorage.setItem(this.config.storage.cursorKey, this.cursorPosition.toString());
        if (this.fileId) {
            sessionStorage.setItem(this.config.storage.fileIdKey, this.fileId);
        }
    }
    
    loadFromStorage() {
        const savedContent = sessionStorage.getItem(this.config.storage.contentKey);
        const savedCursor = sessionStorage.getItem(this.config.storage.cursorKey);
        const savedFileId = sessionStorage.getItem(this.config.storage.fileIdKey);
        
        if (savedContent !== null && savedContent !== this.content) {
            this.isUpdatingFromStorage = true;
            this.content = savedContent;
            this.cursorPosition = savedCursor ? parseInt(savedCursor) : this.content.length;
            this.cursorPosition = Math.max(0, Math.min(this.cursorPosition, this.content.length));
            this.fileId = savedFileId;
            
            this.textBeforeElement.textContent = this.content.substring(0, this.cursorPosition);
            this.textAfterElement.textContent = this.content.substring(this.cursorPosition);
            this.updatePreview();
            this.updateFileInfo();
            
            this.isUpdatingFromStorage = false;
        }
    }
    
    startStorageSync() {
        setInterval(() => {
            if (!this.isUpdatingFromStorage) {
                this.loadFromStorage();
            }
        }, 500);
    }
    
    startAutoSave() {
        this.autoSaveTimer = setInterval(() => {
            if (this.content.trim()) {
                this.saveToAPI(true);
            }
        }, this.config.behavior.autoSaveInterval);
    }
    
    exportMarkdown() {
        const blob = new Blob([this.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.fileId ? `${this.fileId}.md` : 'document.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showStatus('Markdown file exported!', 'success');
    }
    
    async saveToAPI(isAutoSave = false) {
        if (!this.content.trim()) {
            this.showStatus('Nothing to save', 'error');
            return;
        }
        
        try {
            const response = await fetch(this.config.api.saveEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: this.content,
                    fileId: this.fileId
                }),
                signal: AbortSignal.timeout(this.config.api.timeout)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.fileId) {
                this.fileId = data.fileId;
                sessionStorage.setItem(this.config.storage.fileIdKey, this.fileId);
                this.updateFileInfo();
            }
            
            if (!isAutoSave) {
                this.showStatus('Saved successfully!', 'success');
            }
        } catch (error) {
            console.error('Save error:', error);
            if (!isAutoSave) {
                this.showStatus(`Save failed: ${error.message}`, 'error');
            }
        }
    }
    
    clearContent() {
        if (confirm('Are you sure you want to clear all content?')) {
            this.content = '';
            this.cursorPosition = 0;
            this.render();
            this.showStatus('Content cleared', 'success');
        }
    }
    
    newDocument() {
        if (this.content.trim() && !confirm('Start a new document? Unsaved changes will be lost.')) {
            return;
        }
        
        this.content = '';
        this.cursorPosition = 0;
        this.fileId = null;
        sessionStorage.removeItem(this.config.storage.fileIdKey);
        this.render();
        this.updateFileInfo();
        this.showStatus('New document created', 'success');
    }
    
    updateFileInfo() {
        if (this.fileId) {
            this.fileInfoElement.textContent = `File: ${this.fileId}.md`;
        } else {
            this.fileInfoElement.textContent = 'Unsaved document';
        }
    }
    
    showStatus(message, type = 'success') {
        const statusEl = document.getElementById('statusMessage');
        statusEl.textContent = message;
        statusEl.className = `status-message ${type} show`;
        
        setTimeout(() => {
            statusEl.classList.remove('show');
        }, 3000);
    }
    
    // Public API
    getContent() {
        return this.content;
    }
    
    setContent(content) {
        this.content = content;
        this.cursorPosition = content.length;
        this.render();
    }
    
    insertAtCursor(text) {
        this.content = this.content.substring(0, this.cursorPosition) + 
                      text + 
                      this.content.substring(this.cursorPosition);
        this.cursorPosition += text.length;
        this.render();
    }
}

// Initialize editor when DOM is loaded
let editor;

document.addEventListener('DOMContentLoaded', () => {
   
    
    editor = new MarkdownEditor(EditorConfig);
    
    // Make editor available globally
    window.markdownEditor = editor;
});
