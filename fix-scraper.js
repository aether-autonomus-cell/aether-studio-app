const fs = require('fs');
const filePath = 'src/lib/studio/api.ts';
if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  const cleanerFunction = `
export function sanitizeChapterContent(rawHtmlOrText: string): string {
  if (!rawHtmlOrText) return "";
  let cleaned = rawHtmlOrText
    .replace(/cl\\.adform\\.net[^\\s]*/gi, '')
    .replace(/This is a cached snapshot.*?probe/gis, '')
    .replace(/Ad Blocker Detected.*?content\\./gis, '')
    .replace(/(?:footer|copyright|about us|discord|patreon).*$/gim, '')
    .replace(/\\n\\s*\\n/g, '\\n')
    .trim();
  return cleaned;
}
`;
  if (!content.includes('sanitizeChapterContent')) {
    content += cleanerFunction;
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Scraper cleaner added successfully!");
  } else {
    console.log("Cleaner already exists.");
  }
} else {
  console.log("api.ts not found!");
}
