import type { AggregatedContext, AppConfig, SourceReport, SourceReportGroup } from '../types';
import { dedupeReports } from './report-extract';

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 12)).trim()}\n[内容已截断]`;
}

function sortReports(reports: SourceReport[]): SourceReport[] {
  return [...reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function aggregateReports(reports: SourceReport[], config: AppConfig): AggregatedContext {
  const groups: SourceReportGroup[] = [];
  const droppedReportKeys: string[] = [];
  let remainingTotalChars = config.maxTotalChars;

  for (const sourcePrefix of config.sourcePrefixes) {
    const sourceReports = sortReports(reports.filter((report) => report.sourcePrefix === sourcePrefix)).slice(0, config.maxReportsPerSource);
    const { kept, droppedKeys } = dedupeReports(sourceReports);
    droppedReportKeys.push(...droppedKeys);
    const parts: string[] = [];
    const reportsForGroup: SourceReport[] = [];
    let sourceChars = 0;

    for (const report of kept) {
      if (remainingTotalChars <= 0 || sourceChars >= config.maxSourceChars) {
        droppedReportKeys.push(report.key);
        continue;
      }
      const room = Math.min(config.maxReportChars, config.maxSourceChars - sourceChars, remainingTotalChars);
      if (room < 200) {
        droppedReportKeys.push(report.key);
        continue;
      }
      const clipped = clampText(report.extractedText, room);
      reportsForGroup.push({ ...report, extractedText: clipped, excerpt: clampText(report.excerpt, 280) });
      parts.push(`## ${report.generatedAt} | ${report.key}\n${clipped}`);
      sourceChars += clipped.length;
      remainingTotalChars -= clipped.length;
    }

    groups.push({
      sourcePrefix,
      reports: reportsForGroup,
      combinedText: parts.join('\n\n'),
    });
  }

  const llmInput = groups
    .filter((group) => group.combinedText)
    .map((group) => `# 来源: ${group.sourcePrefix}\n${group.combinedText}`)
    .join('\n\n');

  return {
    groups,
    llmInput,
    totalReports: groups.reduce((sum, group) => sum + group.reports.length, 0),
    usedSources: groups.filter((group) => group.reports.length > 0).map((group) => group.sourcePrefix),
    missingSources: groups.filter((group) => group.reports.length === 0).map((group) => group.sourcePrefix),
    droppedReportKeys,
  };
}
