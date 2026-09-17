function automationError(data) {
  if (!Array.isArray(data.triggers) || !data.triggers.length || data.triggers.length > 50 || data.triggers.some(word => typeof word !== 'string' || !word.trim() || word.length > 80)) return 'Add 1–50 trigger words or phrases (up to 80 characters each).';
  if (typeof data.replyTemplate !== 'string' || data.replyTemplate.length > 2000 || !data.replyTemplate.includes('{name}') || !data.replyTemplate.includes('{url}')) return 'Reply template must include both {name} and {url}, and be at most 2000 characters.';
  return null;
}
function imageExtension(bytes) {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
module.exports = { automationError, imageExtension };
