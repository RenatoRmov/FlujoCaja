
import dayjs from 'dayjs';
import 'dayjs/locale/es';

dayjs.locale('es');

export const fmt = (x: number): string => 
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(x || 0);

export const fmtNumExcel = (x: number): string => 
  new Intl.NumberFormat('es-CL', {
    maximumFractionDigits: 0
  }).format(x || 0);

export const ymd = (d: any): string => dayjs(d).format('YYYY-MM-DD');
export const firstDayOfMonth = (m: string): string => dayjs(m).startOf('month').format('YYYY-MM-DD');
export const lastDayOfMonth = (m: string): string => dayjs(m).endOf('month').format('YYYY-MM-DD');
export const getMonthName = (m: string): string => dayjs(m).format('MMMM YYYY');
export const getFriendlyDate = (d: string): string => dayjs(d).format('dddd, D [de] MMMM [de] YYYY');

export const id = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
};

export const isWeekend = (date: string): boolean => {
  const day = dayjs(date).day();
  return day === 0 || day === 6;
};

export const shiftToMonday = (date: string): string => {
  const d = dayjs(date);
  if (d.day() === 6) return d.add(2, 'day').format('YYYY-MM-DD');
  if (d.day() === 0) return d.add(1, 'day').format('YYYY-MM-DD');
  return date;
};

export const groupBy = <T, K extends keyof any>(arr: T[], key: (i: T) => K) =>
  arr.reduce((groups, item) => {
    (groups[key(item)] = groups[key(item)] || []).push(item);
    return groups;
  }, {} as Record<K, T[]>);

export const exportToExcel = (
  filename: string, 
  rows: any[], 
  columns: string[], 
  highlightRowFn?: (row: any) => string | null,
  summaryTableHtml?: string
) => {
  const tableHeader = `<tr style="background-color: #f1f5f9; font-weight: bold;">${columns.map(col => `<th style="border: 1px solid #cbd5e1; padding: 8px;">${col}</th>`).join('')}</tr>`;
  
  const tableRows = rows.map(row => {
    const cellBgColor = highlightRowFn ? highlightRowFn(row) : '#ffffff';
    // Aplicamos el color de fondo a cada TD individualmente en lugar de al TR
    return `<tr>
      ${columns.map(col => {
        const val = row[col];
        const isNumeric = typeof val === 'number';
        const displayVal = isNumeric ? fmtNumExcel(val) : (val ?? '');
        const align = isNumeric ? 'right' : 'left';
        return `<td style="border: 1px solid #e2e8f0; padding: 8px; text-align: ${align}; background-color: ${cellBgColor};">${displayVal}</td>`;
      }).join('')}
    </tr>`;
  }).join('');

  const template = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"></head>
    <body>
      ${summaryTableHtml ? `
        <div style="margin-bottom: 20px;">
          ${summaryTableHtml}
        </div>
      ` : ''}
      <table style="border-collapse: collapse;">
        ${tableHeader}
        ${tableRows}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([template], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
