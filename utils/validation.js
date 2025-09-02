// Validation utility functions

export const validateRequiredFields = (data, requiredFields) => {
  const missingFields = [];
  
  for (const field of requiredFields) {
    if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      missingFields.push(field);
    }
  }
  
  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
};

export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validateApiKey = (apiKey, expectedKey) => {
  return apiKey && apiKey === expectedKey;
};

export const validateProjectId = (projectId) => {
  return projectId && !isNaN(parseInt(projectId));
};

export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/[<>]/g, '');
};

export default {
  validateRequiredFields,
  validateEmail,
  validateApiKey,
  validateProjectId,
  sanitizeInput,
};
