import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Loads all supported document files from a directory
 * @param {string} directoryPath - Path to the directory to read
 * @returns {Promise<Array>} Array of document objects with filename, title, and content
 */
async function loadDocuments(directoryPath) {
  const supportedExtensions = ['.md', '.txt', '.csv', '.yaml', '.yml', '.html', '.json', '.xml'];
  const documents = [];

  try {
    // Read directory contents
    const files = await readdir(directoryPath);

    for (const file of files) {
      const filePath = join(directoryPath, file);
      
      // Get file extension
      const ext = file.substring(file.lastIndexOf('.')).toLowerCase();

      // Check if file has supported extension
      if (supportedExtensions.includes(ext)) {
        try {
          // Read file content as text
          const fileContent = await readFile(filePath, 'utf8');

          // Add to documents array
          documents.push({
            filename: file,
            content: fileContent
          });
        } catch (err) {
          console.error(`Error reading file ${file}:`, err.message);
        }
      }
    }

    return documents;
  } catch (err) {
    console.error(`Error reading directory ${directoryPath}:`, err.message);
    return [];
  }
}

export default loadDocuments;