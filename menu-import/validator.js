/**
 * File & content validator for asset imports.
 *
 * Validates the uploaded file before any parsing occurs.
 * Each future parser (OCR, PDF, Excel, AI) will register its own
 * validation rules here so the pipeline stays uniform.
 */

/**
 * @param {object} file – Multer file object (path, mimetype, size, originalname)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateImportFile(file) {
  const errors = [];

  if (!file) {
    errors.push("No file was uploaded.");
    return { valid: false, errors };
  }

  if (file.size === 0) {
    errors.push("Uploaded file is empty.");
  }

  // Future: file signature / magic-byte checks
  // Future: extension vs mimetype mismatch detection
  // Future: max-page-count for PDFs
  // Future: Excel row-limit validation

  return { valid: errors.length === 0, errors };
}

/**
 * Parsed-item validation.
 * Called after a parser extracts items from the raw file.
 *
 * @param {Array} items – Array of { name, description, price, category }
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateParsedItems(items) {
  const errors = [];

  if (!Array.isArray(items) || items.length === 0) {
    errors.push("No items were found in the file.");
    return { valid: false, errors };
  }

  items.forEach((item, i) => {
    if (!item.name || String(item.name).trim().length === 0) {
      errors.push(`Item #${i + 1}: Name is required.`);
    }
    if (item.price == null || Number(item.price) <= 0) {
      errors.push(`Item #${i + 1}: Price must be greater than 0.`);
    }
    if (item.category != null && String(item.category).trim().length === 0) {
      errors.push(`Item #${i + 1}: Category must not be empty if provided.`);
    }
  });

  return { valid: errors.length === 0, errors };
}
