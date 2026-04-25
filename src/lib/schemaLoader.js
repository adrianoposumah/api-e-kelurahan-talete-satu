import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaCache = new Map();

const normalizeLetterType = (letterType) => {
  if (typeof letterType !== 'string') {
    return '';
  }

  return letterType.trim().toLowerCase();
};

/**
 * Load submission schema from src/templates/<letter_type>/schema.json.
 * Returns null if schema file does not exist or cannot be parsed.
 * @param {string} letterType
 * @returns {object | null}
 */
export const loadSubmissionSchema = (letterType) => {
  const normalizedType = normalizeLetterType(letterType);

  if (!normalizedType) {
    return null;
  }

  if (schemaCache.has(normalizedType)) {
    return schemaCache.get(normalizedType);
  }

  const schemaPath = join(__dirname, '..', 'templates', normalizedType, 'schema.json');
  if (!existsSync(schemaPath)) {
    return null;
  }

  try {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    schemaCache.set(normalizedType, schema);
    return schema;
  } catch {
    return null;
  }
};

export const clearSubmissionSchemaCache = () => {
  schemaCache.clear();
};

export default loadSubmissionSchema;
