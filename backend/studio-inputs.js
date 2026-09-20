function automationError(data) {
  if (!Array.isArray(data.triggers) || !data.triggers.length || data.triggers.length > 50 || data.triggers.some(word => typeof word !== 'string' || !word.trim() || word.length > 80)) return 'Add 1–50 trigger words or phrases (up to 80 characters each).';
  if (typeof data.replyTemplate !== 'string' || data.replyTemplate.length > 2000 || !data.replyTemplate.includes('{name}') || !data.replyTemplate.includes('{url}')) return 'Reply template must include both {name} and {url}, and be at most 2000 characters.';
  return null;
}
module.exports = { automationError };
