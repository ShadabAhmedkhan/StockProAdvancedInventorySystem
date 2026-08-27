import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfColumn {
  header: string;
  align?: 'left' | 'right';
}

export interface PdfSummaryItem {
  label: string;
  value: string;
}

export interface ExportTableToPdfOptions {
  title: string;
  subtitle?: string;
  /** e.g. the active from/to date range, rendered under the subtitle */
  range?: string;
  summary?: PdfSummaryItem[];
  columns: PdfColumn[];
  rows: (string | number)[][];
  filename: string;
}

export function exportTableToPdf({ title, subtitle, range, summary, columns, rows, filename }: ExportTableToPdfOptions): void {
  const doc = new jsPDF({ orientation: columns.length > 5 ? 'landscape' : 'portrait', unit: 'pt' });
  const marginX = 40;
  let cursorY = 48;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Stock Pro', marginX, cursorY);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90);
  doc.text(title, marginX, (cursorY += 20));

  if (subtitle !== undefined) {
    doc.setFontSize(9);
    doc.text(subtitle, marginX, (cursorY += 15));
  }
  if (range !== undefined) {
    doc.setFontSize(9);
    doc.text(range, marginX, (cursorY += 14));
  }

  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Generated ${new Date().toLocaleString()}`, marginX, (cursorY += 14));
  doc.setTextColor(0);

  if (summary !== undefined && summary.length > 0) {
    cursorY += 14;
    const colWidth = (doc.internal.pageSize.getWidth() - marginX * 2) / summary.length;
    summary.forEach((item, index) => {
      const x = marginX + index * colWidth;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(item.label, x, cursorY);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      doc.text(item.value, x, cursorY + 16);
      doc.setFont('helvetica', 'normal');
    });
    cursorY += 30;
  }

  autoTable(doc, {
    startY: cursorY + 12,
    margin: { left: marginX, right: marginX },
    head: [columns.map((column) => column.header)],
    body: rows,
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [63, 81, 181] },
    columnStyles: Object.fromEntries(
      columns.map((column, index) => [index, { halign: column.align ?? 'left' }]),
    ),
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
