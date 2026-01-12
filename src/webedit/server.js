import express from 'express';
const cors = require('cors');

const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;
const DOCUMENTS_DIR = './documents';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public')); // Serve your markdown editor files

// Ensure documents directory exists
async function ensureDocumentsDir() {
    try {
        await fs.access(DOCUMENTS_DIR);
    } catch {
        await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
    }
}

// Save markdown endpoint
app.post('/api/save', async (req, res) => {
    try {
        const { content, fileId } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        let uuid = crypto.randomUUID();

        // Use existing fileId or generate new UUID
        const id = fileId || uuid;
        const filename = `${id}.md`;
        const filepath = path.join(DOCUMENTS_DIR, filename);
        
        // Save file
        await fs.writeFile(filepath, content, 'utf8');
        
        console.log(`Saved file: ${filename}`);
        
        res.json({ 
            fileId: id, 
            success: true,
            filename: filename 
        });
    } catch (error) {
        console.error('Save error:', error);
        res.status(500).json({ 
            error: 'Failed to save file',
            message: error.message 
        });
    }
});

// Get markdown file by ID
app.get('/api/file/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const filepath = path.join(DOCUMENTS_DIR, `${fileId}.md`);
        
        const content = await fs.readFile(filepath, 'utf8');
        
        res.json({ 
            fileId, 
            content,
            success: true 
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else {
            res.status(500).json({ 
                error: 'Failed to read file',
                message: error.message 
            });
        }
    }
});

// List all markdown files
app.get('/api/files', async (req, res) => {
    try {
        const files = await fs.readdir(DOCUMENTS_DIR);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        
        const fileList = await Promise.all(
            mdFiles.map(async (filename) => {
                const filepath = path.join(DOCUMENTS_DIR, filename);
                const stats = await fs.stat(filepath);
                const fileId = filename.replace('.md', '');
                
                return {
                    fileId,
                    filename,
                    size: stats.size,
                    modified: stats.mtime
                };
            })
        );
        
        res.json({ files: fileList, success: true });
    } catch (error) {
        res.status(500).json({ 
            error: 'Failed to list files',
            message: error.message 
        });
    }
});

// Delete markdown file
app.delete('/api/file/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const filepath = path.join(DOCUMENTS_DIR, `${fileId}.md`);
        
        await fs.unlink(filepath);
        
        res.json({ 
            success: true,
            message: 'File deleted' 
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.status(404).json({ error: 'File not found' });
        } else {
            res.status(500).json({ 
                error: 'Failed to delete file',
                message: error.message 
            });
        }
    }
});

// Start server
async function start() {
    await ensureDocumentsDir();
    app.listen(PORT, () => {
        console.log(`Markdown Editor API Server running on http://localhost:${PORT}`);
        console.log(`Documents stored in: ${path.resolve(DOCUMENTS_DIR)}`);
    });
}

start().catch(console.error);