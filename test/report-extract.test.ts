import { describe, expect, it } from 'vitest';
import { extractTextFromReport } from '../src/lib/report-extract';

describe('extractTextFromReport', () => {
  it('removes scripts/styles and keeps meaningful body text', () => {
    const { extractedText } = extractTextFromReport(`
      <html><head><style>.x{}</style><script>ignore()</script></head>
      <body><div>今日结论</div><p>市场情绪回暖。</p><p>风险提示：波动仍大。</p></body></html>
    `, 500);

    expect(extractedText).toContain('市场情绪回暖');
    expect(extractedText).toContain('市场情绪回暖');
    expect(extractedText).not.toContain('ignore()');
  });
});
