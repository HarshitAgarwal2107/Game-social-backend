export function extractMentions(text = "") {
  const regex = /@([a-zA-Z0-9_]+)/g;
  const mentions = new Set();
  let match;

  while ((match = regex.exec(text)) !== null) {
    mentions.add(match[1]);
  }

  return Array.from(mentions);
}
