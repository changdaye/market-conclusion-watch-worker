import type { SourceReport } from '../types';

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/tr|\/h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' '),
  );
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function extractTextFromReport(content: string, maxChars: number): { extractedText: string; excerpt: string } {
  const looksLikeHtml = /<html|<body|<div|<p|<table/i.test(content);
  const raw = looksLikeHtml ? stripTags(content) : content;
  const normalized = normalizeWhitespace(raw);
  const extractedText = normalized.slice(0, maxChars).trim();
  const excerpt = extractedText.slice(0, 280).trim();
  return { extractedText, excerpt };
}

export function dedupeReports(reports: SourceReport[]): { kept: SourceReport[]; droppedKeys: string[] } {
  const seen = new Set<string>();
  const kept: SourceReport[] = [];
  const droppedKeys: string[] = [];
  for (const report of reports) {
    const fingerprint = report.extractedText
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800);
    if (!fingerprint || seen.has(fingerprint)) {
      droppedKeys.push(report.key);
      continue;
    }
    seen.add(fingerprint);
    kept.push(report);
  }
  return { kept, droppedKeys };
}
