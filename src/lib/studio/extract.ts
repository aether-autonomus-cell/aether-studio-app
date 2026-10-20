/** Readable text from a public page. The chapter is not clipped to 8,000 characters. */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  const paragraphs = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 40);
  const text = paragraphs.length
    ? paragraphs.join("\n\n")
    : stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { title: title.slice(0, 120), text };
}
