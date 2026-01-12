// Configuration for Markdown Editor
const EditorConfig = {
    // Color scheme
    colors: {
        background: '#1e1e1e',
        editorBackground: '#252526',
        previewBackground: '#1e1e1e',
        text: '#d4d4d4',
        cursor: '#aeafad',
        selection: '#264f78',
        menuBackground: '#2d2d30',
        menuText: '#cccccc',
        menuHover: '#3e3e42',
        border: '#3e3e42',
        scrollbar: '#424242',
        scrollbarHover: '#4e4e4e',
        accentPrimary: '#007acc',
        accentSecondary: '#4ec9b0',
        buttonBackground: '#0e639c',
        buttonHover: '#1177bb',
        buttonText: '#ffffff'
    },
    
    // Typography
    typography: {
        editorFontFamily: "'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace",
        editorFontSize: '14px',
        editorLineHeight: '1.6',
        previewFontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
        previewFontSize: '16px',
        previewLineHeight: '1.6'
    },
    
    // Layout
    layout: {
        menuHeight: '40px',
        splitRatio: 0.5, // 50% editor, 50% preview
        padding: '20px',
        borderRadius: '4px',
        maxWidth: '1800px'
    },
    
    // Editor behavior
    behavior: {
        tabSize: 4,
        autoSave: true,
        autoSaveInterval: 5000, // milliseconds
        syncScroll: true,
        livePreview: true
    },
    
    // API Configuration
    api: {
        saveEndpoint: 'http://localhost:3000/api/save', // Change to your actual endpoint
        timeout: 10000 // milliseconds
    },
    
    // Storage
    storage: {
        contentKey: 'markdown_editor_content',
        cursorKey: 'markdown_editor_cursor',
        fileIdKey: 'markdown_editor_file_id'
    }
};
