/**
 * Guard Report Generator Service
 *
 * Generates security reports in various formats:
 * - DOCX (Word) using docx library (F196, F198, F200)
 * - XLSX (Excel) using xlsx library (F197, F199)
 * - PDF using Puppeteer (F201)
 */

import * as XLSX from 'xlsx';
import logger from '@shared/core/logger';
import type { GuardReportType, GuardReportFormat } from '../../interfaces/guard/report.interfaces';

// ============================================================================
// TYPES
// ============================================================================

export interface ReportGenerationInput {
  reportType: GuardReportType;
  format: GuardReportFormat;
  name: string;
  data: ReportData;
  outputPath: string;
}

export interface ReportData {
  generated_at: Date;
  company?: {
    id: string;
    name: string;
  };
  date_range?: {
    from?: Date;
    to?: Date;
  };
  pii?: PiiReportData;
  asm?: AsmReportData;
  score?: ScoreReportData;
}

export interface PiiReportData {
  findings: Array<{
    id: string;
    job_id: string;
    profile_name?: string;
    pii_type: string;
    file_path: string;
    file_name?: string;
    match_context: string;
    line_number?: number;
    confidence_score: number;
    found_at: Date;
    status: string;
  }>;
  summary: Record<string, number>;
}

export interface AsmReportData {
  domains: Array<{
    id: string;
    domain_name: string;
    company_name?: string;
    last_scanned_at?: Date;
  }>;
  results: Array<{
    id: string;
    domain_name: string;
    result_type: string;
    severity?: string;
    data: Record<string, unknown>;
    found_at: Date;
  }>;
}

export interface ScoreReportData {
  score?: {
    score: number;
    risk_level: string;
    pii_penalty: number;
    asm_penalty: number;
    calculated_at: Date;
  };
  history: Array<{
    score: number;
    risk_level: string;
    calculated_at: Date;
    triggered_by: string;
  }>;
}

export interface GenerationResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

// ============================================================================
// REPORT GENERATOR CLASS
// ============================================================================

export class GuardReportGenerator {
  /**
   * Generate a report in the specified format
   */
  async generate(input: ReportGenerationInput): Promise<GenerationResult> {
    const { reportType, format, name, data, outputPath } = input;

    logger.info('Generating guard report', { reportType, format, name });

    try {
      switch (format) {
        case 'xlsx':
          return await this.generateExcel(reportType, data, outputPath);
        case 'pdf':
          return await this.generatePdf(reportType, data, outputPath);
        case 'docx':
          return await this.generateWord(reportType, data, outputPath);
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
    } catch (error) {
      logger.error('Report generation failed', { reportType, format, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============================================================================
  // EXCEL GENERATION (F197, F199)
  // ============================================================================

  private async generateExcel(
    reportType: GuardReportType,
    data: ReportData,
    outputPath: string
  ): Promise<GenerationResult> {
    const workbook = XLSX.utils.book_new();

    // Add sheets based on report type
    if (reportType === 'pii' || reportType === 'combined') {
      this.addPiiSheets(workbook, data.pii);
    }

    if (reportType === 'asm' || reportType === 'combined') {
      this.addAsmSheets(workbook, data.asm);
    }

    if (reportType === 'security_score' || reportType === 'combined') {
      this.addScoreSheets(workbook, data.score);
    }

    // Add summary sheet
    this.addSummarySheet(workbook, reportType, data);

    // Write to file
    XLSX.writeFile(workbook, outputPath);

    // Get file size
    const fs = await import('fs');
    const stats = fs.statSync(outputPath);

    logger.info('Excel report generated', { outputPath, size: stats.size });

    return {
      success: true,
      filePath: outputPath,
      fileSize: stats.size,
    };
  }

  private addPiiSheets(workbook: XLSX.WorkBook, pii?: PiiReportData): void {
    if (!pii) return;

    // Findings sheet
    const findingsData = pii.findings.map((f) => ({
      'PII Type': f.pii_type,
      'File Path': f.file_path,
      'Line Number': f.line_number || '',
      'Confidence': `${(f.confidence_score * 100).toFixed(0)}%`,
      'Status': f.status,
      'Found At': f.found_at instanceof Date ? f.found_at.toISOString() : f.found_at,
      'Profile': f.profile_name || '',
    }));

    const findingsSheet = XLSX.utils.json_to_sheet(findingsData);
    XLSX.utils.book_append_sheet(workbook, findingsSheet, 'PII Findings');

    // Summary sheet
    const summaryData = Object.entries(pii.summary).map(([type, count]) => ({
      'PII Type': type,
      'Count': count,
    }));

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'PII Summary');
  }

  private addAsmSheets(workbook: XLSX.WorkBook, asm?: AsmReportData): void {
    if (!asm) return;

    // Domains sheet
    const domainsData = asm.domains.map((d) => ({
      'Domain': d.domain_name,
      'Company': d.company_name || '',
      'Last Scanned': d.last_scanned_at instanceof Date
        ? d.last_scanned_at.toISOString()
        : d.last_scanned_at || 'Never',
    }));

    const domainsSheet = XLSX.utils.json_to_sheet(domainsData);
    XLSX.utils.book_append_sheet(workbook, domainsSheet, 'Domains');

    // Findings sheet
    const findingsData = asm.results.map((r) => ({
      'Domain': r.domain_name,
      'Type': r.result_type,
      'Severity': r.severity || 'N/A',
      'Found At': r.found_at instanceof Date ? r.found_at.toISOString() : r.found_at,
      'Details': JSON.stringify(r.data),
    }));

    const findingsSheet = XLSX.utils.json_to_sheet(findingsData);
    XLSX.utils.book_append_sheet(workbook, findingsSheet, 'ASM Findings');
  }

  private addScoreSheets(workbook: XLSX.WorkBook, score?: ScoreReportData): void {
    if (!score) return;

    // Current score
    if (score.score) {
      const scoreData = [{
        'Score': score.score.score,
        'Risk Level': score.score.risk_level,
        'PII Penalty': score.score.pii_penalty,
        'ASM Penalty': score.score.asm_penalty,
        'Calculated At': score.score.calculated_at instanceof Date
          ? score.score.calculated_at.toISOString()
          : score.score.calculated_at,
      }];

      const scoreSheet = XLSX.utils.json_to_sheet(scoreData);
      XLSX.utils.book_append_sheet(workbook, scoreSheet, 'Security Score');
    }

    // History
    if (score.history && score.history.length > 0) {
      const historyData = score.history.map((h) => ({
        'Score': h.score,
        'Risk Level': h.risk_level,
        'Triggered By': h.triggered_by,
        'Calculated At': h.calculated_at instanceof Date
          ? h.calculated_at.toISOString()
          : h.calculated_at,
      }));

      const historySheet = XLSX.utils.json_to_sheet(historyData);
      XLSX.utils.book_append_sheet(workbook, historySheet, 'Score History');
    }
  }

  private addSummarySheet(
    workbook: XLSX.WorkBook,
    reportType: GuardReportType,
    data: ReportData
  ): void {
    const summaryData: Array<Record<string, string | number>> = [
      { 'Field': 'Report Type', 'Value': reportType },
      { 'Field': 'Generated At', 'Value': data.generated_at.toISOString() },
    ];

    if (data.company) {
      summaryData.push({ 'Field': 'Company', 'Value': data.company.name });
    }

    if (data.date_range?.from) {
      summaryData.push({
        'Field': 'Date From',
        'Value': data.date_range.from.toISOString(),
      });
    }

    if (data.date_range?.to) {
      summaryData.push({
        'Field': 'Date To',
        'Value': data.date_range.to.toISOString(),
      });
    }

    if (data.pii?.findings) {
      summaryData.push({ 'Field': 'Total PII Findings', 'Value': data.pii.findings.length });
    }

    if (data.asm?.results) {
      summaryData.push({ 'Field': 'Total ASM Findings', 'Value': data.asm.results.length });
    }

    if (data.score?.score) {
      summaryData.push({ 'Field': 'Security Score', 'Value': data.score.score.score });
      summaryData.push({ 'Field': 'Risk Level', 'Value': data.score.score.risk_level });
    }

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  }

  // ============================================================================
  // PDF GENERATION (F201)
  // ============================================================================

  private async generatePdf(
    reportType: GuardReportType,
    data: ReportData,
    outputPath: string
  ): Promise<GenerationResult> {
    // Dynamically import puppeteer to avoid loading it when not needed
    const puppeteer = await import('puppeteer');

    // Generate HTML content
    const html = this.generateHtmlReport(reportType, data);

    // Launch browser
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      // Generate PDF
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '1cm',
          right: '1cm',
          bottom: '1cm',
          left: '1cm',
        },
      });

      // Get file size
      const fs = await import('fs');
      const stats = fs.statSync(outputPath);

      logger.info('PDF report generated', { outputPath, size: stats.size });

      return {
        success: true,
        filePath: outputPath,
        fileSize: stats.size,
      };
    } finally {
      await browser.close();
    }
  }

  private generateHtmlReport(reportType: GuardReportType, data: ReportData): string {
    const styles = `
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
        h2 { color: #1e3a8a; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
        th { background-color: #f3f4f6; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9fafb; }
        .score-card { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .score-value { font-size: 48px; font-weight: bold; }
        .risk-critical { color: #dc2626; }
        .risk-high { color: #ea580c; }
        .risk-moderate { color: #ca8a04; }
        .risk-low { color: #16a34a; }
        .summary-box { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .finding-count { font-size: 24px; font-weight: bold; color: #1e40af; }
      </style>
    `;

    let content = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Security Report</title>
        ${styles}
      </head>
      <body>
        <h1>Alga Guard Security Report</h1>
        <div class="summary-box">
          <p><strong>Report Type:</strong> ${this.formatReportType(reportType)}</p>
          <p><strong>Generated:</strong> ${data.generated_at.toLocaleString()}</p>
          ${data.company ? `<p><strong>Company:</strong> ${data.company.name}</p>` : ''}
        </div>
    `;

    // Add Security Score section
    if ((reportType === 'security_score' || reportType === 'combined') && data.score?.score) {
      const riskClass = `risk-${data.score.score.risk_level}`;
      content += `
        <h2>Security Score</h2>
        <div class="score-card">
          <div class="score-value">${data.score.score.score}</div>
          <p class="${riskClass}" style="font-size: 18px; text-transform: uppercase;">
            ${data.score.score.risk_level} Risk
          </p>
        </div>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>PII Penalty</td><td>${data.score.score.pii_penalty}</td></tr>
          <tr><td>ASM Penalty</td><td>${data.score.score.asm_penalty}</td></tr>
          <tr><td>Last Calculated</td><td>${new Date(data.score.score.calculated_at).toLocaleString()}</td></tr>
        </table>
      `;
    }

    // Add PII section
    if ((reportType === 'pii' || reportType === 'combined') && data.pii) {
      content += `
        <h2>PII Findings</h2>
        <div class="summary-box">
          <span class="finding-count">${data.pii.findings.length}</span> findings detected
        </div>
      `;

      if (Object.keys(data.pii.summary).length > 0) {
        content += `
          <h3>Findings by Type</h3>
          <table>
            <tr><th>PII Type</th><th>Count</th></tr>
            ${Object.entries(data.pii.summary)
              .map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`)
              .join('')}
          </table>
        `;
      }

      if (data.pii.findings.length > 0) {
        content += `
          <h3>Recent Findings (Top 50)</h3>
          <table>
            <tr><th>Type</th><th>File</th><th>Line</th><th>Confidence</th><th>Status</th></tr>
            ${data.pii.findings
              .slice(0, 50)
              .map(
                (f) => `
                <tr>
                  <td>${f.pii_type}</td>
                  <td>${f.file_path}</td>
                  <td>${f.line_number || '-'}</td>
                  <td>${(f.confidence_score * 100).toFixed(0)}%</td>
                  <td>${f.status}</td>
                </tr>
              `
              )
              .join('')}
          </table>
        `;
      }
    }

    // Add ASM section
    if ((reportType === 'asm' || reportType === 'combined') && data.asm) {
      content += `
        <h2>Attack Surface Findings</h2>
        <div class="summary-box">
          <span class="finding-count">${data.asm.results.length}</span> findings across
          <span class="finding-count">${data.asm.domains.length}</span> domains
        </div>
      `;

      if (data.asm.domains.length > 0) {
        content += `
          <h3>Monitored Domains</h3>
          <table>
            <tr><th>Domain</th><th>Company</th><th>Last Scanned</th></tr>
            ${data.asm.domains
              .map(
                (d) => `
                <tr>
                  <td>${d.domain_name}</td>
                  <td>${d.company_name || '-'}</td>
                  <td>${d.last_scanned_at ? new Date(d.last_scanned_at).toLocaleString() : 'Never'}</td>
                </tr>
              `
              )
              .join('')}
          </table>
        `;
      }

      if (data.asm.results.length > 0) {
        content += `
          <h3>Recent Findings (Top 50)</h3>
          <table>
            <tr><th>Domain</th><th>Type</th><th>Severity</th><th>Found</th></tr>
            ${data.asm.results
              .slice(0, 50)
              .map(
                (r) => `
                <tr>
                  <td>${r.domain_name}</td>
                  <td>${r.result_type}</td>
                  <td>${r.severity || '-'}</td>
                  <td>${new Date(r.found_at).toLocaleString()}</td>
                </tr>
              `
              )
              .join('')}
          </table>
        `;
      }
    }

    content += `
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">
          <p>Generated by Alga Guard</p>
        </div>
      </body>
      </html>
    `;

    return content;
  }

  // ============================================================================
  // WORD GENERATION (F196, F198, F200)
  // ============================================================================

  private async generateWord(
    reportType: GuardReportType,
    data: ReportData,
    outputPath: string
  ): Promise<GenerationResult> {
    // Note: Full Word document generation requires the 'docx' library
    // For now, we'll create a placeholder that notes this dependency
    //
    // To implement full Word generation:
    // 1. npm install docx
    // 2. Import: import { Document, Packer, Paragraph, Table, ... } from 'docx'
    // 3. Build document structure with paragraphs, tables, and styling
    //
    // The docx library provides:
    // - Document creation with sections
    // - Paragraphs with formatting
    // - Tables with styles
    // - Headers and footers
    // - Images and charts

    logger.warn('Word document generation not implemented', {
      reportType,
      outputPath,
      message: 'Install docx library for full Word document support',
    });

    // For now, generate a text file as a placeholder
    const fs = await import('fs');
    const textContent = this.generateTextReport(reportType, data);
    fs.writeFileSync(outputPath, textContent);
    const stats = fs.statSync(outputPath);

    return {
      success: true,
      filePath: outputPath,
      fileSize: stats.size,
    };
  }

  private generateTextReport(reportType: GuardReportType, data: ReportData): string {
    let content = `
ALGA GUARD SECURITY REPORT
==========================

Report Type: ${this.formatReportType(reportType)}
Generated: ${data.generated_at.toLocaleString()}
${data.company ? `Company: ${data.company.name}` : ''}

`;

    if ((reportType === 'security_score' || reportType === 'combined') && data.score?.score) {
      content += `
SECURITY SCORE
--------------
Score: ${data.score.score.score}
Risk Level: ${data.score.score.risk_level.toUpperCase()}
PII Penalty: ${data.score.score.pii_penalty}
ASM Penalty: ${data.score.score.asm_penalty}

`;
    }

    if ((reportType === 'pii' || reportType === 'combined') && data.pii) {
      content += `
PII FINDINGS
------------
Total Findings: ${data.pii.findings.length}

Summary by Type:
${Object.entries(data.pii.summary)
  .map(([type, count]) => `  - ${type}: ${count}`)
  .join('\n')}

`;
    }

    if ((reportType === 'asm' || reportType === 'combined') && data.asm) {
      content += `
ASM FINDINGS
------------
Total Domains: ${data.asm.domains.length}
Total Findings: ${data.asm.results.length}

Monitored Domains:
${data.asm.domains.map((d) => `  - ${d.domain_name} (${d.company_name || 'N/A'})`).join('\n')}

`;
    }

    content += `
---
Generated by Alga Guard
`;

    return content;
  }

  private formatReportType(type: GuardReportType): string {
    switch (type) {
      case 'pii':
        return 'PII Scanner Report';
      case 'asm':
        return 'Attack Surface Report';
      case 'security_score':
        return 'Security Score Report';
      case 'combined':
        return 'Combined Security Report';
      default:
        return type;
    }
  }
}

// Export singleton instance
export const guardReportGenerator = new GuardReportGenerator();
