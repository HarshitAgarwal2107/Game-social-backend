export function renderMentions(text) {
  return text.split(/(@[a-zA-Z0-9_]+)/g).map((part, i) => {
    if (part.startsWith("@")) {
      const username = part.slice(1);
      return (
        <a key={i} href={`/u/${username}`} style={{ color: "#60a5fa" }}>
          {part}
        </a>
      );
    }
    return part;
  });
}
