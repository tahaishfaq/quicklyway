/**
 * Validation utilities
 */
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateBudget = (budget) => {
  return typeof budget === 'number' && budget > 0;
};

const validateString = (str, minLength = 0, maxLength = Infinity) => {
  return (
    typeof str === 'string' &&
    str.length >= minLength &&
    str.length <= maxLength
  );
};

/**
 * Format utilities
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

const formatDate = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
};

module.exports = {
  validateEmail,
  validateBudget,
  validateString,
  formatCurrency,
  formatDate,
};

