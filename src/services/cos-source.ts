import { extractTextFromReport } from '../lib/report-extract';
import { daysAgo } from '../lib/time';
import type { AppConfig, SourceReport } from '../types';
import { fetchCosObjectText, listCosObjects } from './cos';

const REPORT_FILE_PATTERN = /(\d{14})\.(html?|md|txt)$/i;

function parseTimestampFromKey(key: string): string | undefined {
  const matched = key.match(REPORT_FILE_PATTERN);
  if (!matched) return undefined;
  const stamp = matched[1];
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
}

function isRecent(iso: string, lookbackDays: number, now: Date): boolean {
  const date = Date.parse(iso);
  if (Number.isNaN(date)) return false;
  return date >= daysAgo(now, lookbackDays).getTime();
}

export async function collectRecentSourceReports(config: AppConfig, now = new Date()): Promise<SourceReport[]> {
  const reports: SourceReport[] = [];
  for (const prefix of config.sourcePrefixes) {
    const objects = await listCosObjects(config, prefix);
    const candidates = objects
      .filter((item) => REPORT_FILE_PATTERN.test(item.key))
      .map((item) => ({ ...item, generatedAt: parseTimestampFromKey(item.key) ?? item.lastModified }))
      .filter((item): item is typeof item & { generatedAt: string } => Boolean(item.generatedAt && isRecent(item.generatedAt, config.lookbackDays, now)))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .slice(0, config.maxReportsPerSource);

    for (const object of candidates) {
      const rawContent = await fetchCosObjectText(config, object.key);
      const { extractedText, excerpt } = extractTextFromReport(rawContent, config.maxReportChars);
      if (!extractedText) continue;
      reports.push({
        sourcePrefix: prefix,
        key: object.key,
        generatedAt: object.generatedAt,
        publicUrl: `${config.cosBaseUrl.replace(/\/+$/, '')}/${object.key}`,
        rawContent,
        extractedText,
        excerpt,
      });
    }
  }
  return reports;
}
