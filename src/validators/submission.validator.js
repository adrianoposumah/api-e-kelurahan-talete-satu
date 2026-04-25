/**
 * Validate schema-driven submission payload and files.
 * @param {object} body
 * @param {Record<string, Array<object>>} files
 * @param {object} schema
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateSubmission = (body, files, schema) => {
  const errors = [];
  const submissionBody = body || {};
  const uploadedFiles = files || {};

  const schemaFields = Array.isArray(schema?.fields) ? schema.fields : [];
  const schemaFiles = Array.isArray(schema?.files) ? schema.files : [];

  for (const field of schemaFields) {
    if (!field?.required) {
      continue;
    }

    const value = submissionBody[field.name];
    const isMissing = value === undefined || value === null || String(value).trim() === '';
    if (isMissing) {
      errors.push(`Field '${field.name}' is required`);
    }
  }

  for (const fileField of schemaFiles) {
    if (!fileField?.required) {
      continue;
    }

    const fileEntries = uploadedFiles[fileField.name];
    if (!Array.isArray(fileEntries) || fileEntries.length === 0) {
      errors.push(`File '${fileField.name}' is required`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export default validateSubmission;
