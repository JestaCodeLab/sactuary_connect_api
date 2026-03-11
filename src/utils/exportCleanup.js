import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.join(__dirname, '../../exports');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export const cleanupExports = () => {
  try {
    if (!fs.existsSync(EXPORTS_DIR)) return;

    const files = fs.readdirSync(EXPORTS_DIR);
    const now = Date.now();

    for (const file of files) {
      if (file === '.gitkeep') continue;
      const filePath = path.join(EXPORTS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (error) {
    console.error('Export cleanup error:', error);
  }
};
