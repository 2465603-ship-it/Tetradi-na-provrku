import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface ReportErrorItem {
  lineNumber: number;
  category: string;
  wrongText: string;
  correctText: string;
  explanation: string;
  ruleRef?: string;
  confirmedByTeacher?: boolean;
}

export interface ReportHandwritingVerification {
  match: boolean;
  confidence_score: number;
  reasoning: string;
}

export interface NotebookReportPayload {
  studentName: string;
  classGroup: string;
  subject: string;
  assignmentTitle: string;
  submittedDate: string;
  teacherName?: string;
  isFirstGradeNoGrades?: boolean;
  contentGrade: number;
  calligraphyGrade: number;
  praiseStamp?: string;
  errors: ReportErrorItem[];
  parentMessage: string;
  handwritingVerification?: ReportHandwritingVerification;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

const FONT_CANDIDATES = {
  regular: [
    path.join(MODULE_DIR, 'fonts', 'DejaVuSans.ttf'),
    path.join(process.cwd(), 'utils', 'fonts', 'DejaVuSans.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ],
  bold: [
    path.join(MODULE_DIR, 'fonts', 'DejaVuSans-Bold.ttf'),
    path.join(process.cwd(), 'utils', 'fonts', 'DejaVuSans-Bold.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ],
};

function resolveFontPath(list: string[]): string | null {
  for (const candidate of list) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore fs probe errors
    }
  }
  return null;
}

function cleanText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim() || fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254 || /[\r\n]/.test(email)) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getSmtpConfigFromEnv(): SmtpConfig | null {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').trim();

  if (
    !host ||
    !user ||
    !pass ||
    host === 'MY_SMTP_HOST' ||
    user === 'MY_SMTP_USER' ||
    pass === 'MY_SMTP_PASSWORD'
  ) {
    return null;
  }

  const parsedPort = Number(process.env.SMTP_PORT);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 465;

  const rawSecure = (process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure =
    rawSecure === 'true'
      ? true
      : rawSecure === 'false'
        ? false
        : port === 465;

  const fromEnv = (process.env.SMTP_FROM || '').trim();
  const from =
    fromEnv && fromEnv !== 'MY_SMTP_FROM'
      ? fromEnv
      : `ТетрадьПлюс <${user}>`;

  return { host, port, secure, user, pass, from };
}

export function isSmtpConfigured(): boolean {
  return getSmtpConfigFromEnv() !== null;
}

function categoryLabelRu(category: string): string {
  switch (category) {
    case 'orthography':
      return 'Орфография';
    case 'punctuation':
      return 'Пунктуация';
    case 'calculation':
      return 'Вычисление';
    case 'calligraphy':
      return 'Каллиграфия';
    default:
      return category || 'Замечание';
  }
}

export async function generateNotebookReportPdf(
  payload: NotebookReportPayload
): Promise<Buffer> {
  const regularFont = resolveFontPath(FONT_CANDIDATES.regular);
  const boldFont = resolveFontPath(FONT_CANDIDATES.bold);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: {
          Title: `Отчёт о проверке тетради — ${cleanText(payload.studentName, 'Ученик')}`,
          Author: cleanText(payload.teacherName, 'Учитель начальных классов'),
          Subject: `${cleanText(payload.subject)} — ${cleanText(payload.assignmentTitle)}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      if (regularFont) {
        doc.registerFont('Regular', regularFont);
      }
      if (boldFont) {
        doc.registerFont('Bold', boldFont);
      } else if (regularFont) {
        doc.registerFont('Bold', regularFont);
      }

      const fontRegular = regularFont ? 'Regular' : 'Helvetica';
      const fontBold = boldFont || regularFont ? 'Bold' : 'Helvetica-Bold';

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const startX = doc.page.margins.left;

      const studentName = cleanText(payload.studentName, 'Ученик');
      const classGroup = cleanText(payload.classGroup, 'Начальная школа');
      const subject = cleanText(payload.subject, 'Предмет');
      const assignmentTitle = cleanText(payload.assignmentTitle, 'Проверка тетради');
      const submittedDate = cleanText(payload.submittedDate, new Date().toLocaleDateString('ru-RU'));
      const teacherName = cleanText(payload.teacherName, 'Учитель');
      const praiseStamp = cleanText(payload.praiseStamp, '');
      const parentMessage = cleanText(
        payload.parentMessage,
        'Работа проверена. Рекомендуем закрепить пройденный материал дома.'
      );

      // Header Banner
      doc.rect(startX, 42, pageWidth, 64).fill('#0F172A');
      doc
        .fillColor('#FFFFFF')
        .font(fontBold)
        .fontSize(16)
        .text('ТетрадьПлюс — Отчёт о проверке тетради', startX + 18, 56, {
          width: pageWidth - 36,
        });
      doc
        .fillColor('#CBD5E1')
        .font(fontRegular)
        .fontSize(9.5)
        .text(
          `Педагогический отчёт для родителей · Дата формирования: ${new Date().toLocaleDateString('ru-RU')}`,
          startX + 18,
          80,
          { width: pageWidth - 36 }
        );

      let y = 124;

      // Student & Assignment Meta Card
      doc
        .roundedRect(startX, y, pageWidth, 86, 6)
        .fillAndStroke('#F8FAFC', '#CBD5E1');

      doc
        .fillColor('#0F172A')
        .font(fontBold)
        .fontSize(13)
        .text(studentName, startX + 16, y + 14, { width: pageWidth - 32 });

      doc
        .fillColor('#475569')
        .font(fontRegular)
        .fontSize(10)
        .text(`Класс: ${classGroup}   ·   Предмет: ${subject}`, startX + 16, y + 34, {
          width: pageWidth - 32,
        })
        .text(`Задание: ${assignmentTitle}`, startX + 16, y + 50, {
          width: pageWidth - 32,
        })
        .text(`Дата работы: ${submittedDate}   ·   Учитель: ${teacherName}`, startX + 16, y + 66, {
          width: pageWidth - 32,
        });

      y += 102;

      // Grades Summary Row
      const boxGap = 12;
      const boxWidth = (pageWidth - boxGap * 2) / 3;

      // Box 1: Content Grade
      doc
        .roundedRect(startX, y, boxWidth, 58, 6)
        .fillAndStroke('#FEF2F2', '#FECACA');
      doc
        .fillColor('#991B1B')
        .font(fontRegular)
        .fontSize(9)
        .text('За содержание работы', startX + 12, y + 10, { width: boxWidth - 24 });
      doc
        .fillColor('#B91C1C')
        .font(fontBold)
        .fontSize(18)
        .text(
          payload.isFirstGradeNoGrades ? 'Усвоено' : `${payload.contentGrade} / 5`,
          startX + 12,
          y + 26,
          { width: boxWidth - 24 }
        );

      // Box 2: Calligraphy Grade
      doc
        .roundedRect(startX + boxWidth + boxGap, y, boxWidth, 58, 6)
        .fillAndStroke('#F0F9FF', '#BAE6FD');
      doc
        .fillColor('#075985')
        .font(fontRegular)
        .fontSize(9)
        .text('Каллиграфия и аккуратность', startX + boxWidth + boxGap + 12, y + 10, {
          width: boxWidth - 24,
        });
      doc
        .fillColor('#0369A1')
        .font(fontBold)
        .fontSize(18)
        .text(
          payload.isFirstGradeNoGrades ? 'Зачёт' : `${payload.calligraphyGrade} / 5`,
          startX + boxWidth + boxGap + 12,
          y + 26,
          { width: boxWidth - 24 }
        );

      // Box 3: Confirmed Errors Count
      const confirmedErrors = (Array.isArray(payload.errors) ? payload.errors : []).filter(
        (e) => e && e.confirmedByTeacher !== false
      );
      doc
        .roundedRect(startX + (boxWidth + boxGap) * 2, y, boxWidth, 58, 6)
        .fillAndStroke('#F8FAFC', '#CBD5E1');
      doc
        .fillColor('#475569')
        .font(fontRegular)
        .fontSize(9)
        .text('Выявлено замечаний', startX + (boxWidth + boxGap) * 2 + 12, y + 10, {
          width: boxWidth - 24,
        });
      doc
        .fillColor('#0F172A')
        .font(fontBold)
        .fontSize(18)
        .text(`${confirmedErrors.length}`, startX + (boxWidth + boxGap) * 2 + 12, y + 26, {
          width: boxWidth - 24,
        });

      y += 72;

      if (praiseStamp) {
        doc
          .fillColor('#065F46')
          .font(fontBold)
          .fontSize(10)
          .text(`Отметка учителя: «${praiseStamp}»`, startX, y, { width: pageWidth });
        y += 20;
      }

      if (payload.handwritingVerification) {
        const hw = payload.handwritingVerification;
        const pct = Math.round(
          Math.max(0, Math.min(1, Number(hw.confidence_score) || 0)) * 100
        );
        const hwBg = hw.match ? '#ECFDF5' : '#FFFBEB';
        const hwBorder = hw.match ? '#A7F3D0' : '#FDE68A';
        const hwColor = hw.match ? '#065F46' : '#92400E';
        const hwTitle = hw.match
          ? `Сверка почерка с эталоном: совпадает (уверенность ${pct}%)`
          : `Сверка почерка с эталоном: выявлены отличия (уверенность ${pct}%)`;
        const hwReason = cleanText(hw.reasoning, '');
        const textHeight = doc
          .font(fontRegular)
          .fontSize(9)
          .heightOfString(hwReason, { width: pageWidth - 24 });
        const hwBoxHeight = Math.max(44, 28 + textHeight);

        doc.roundedRect(startX, y, pageWidth, hwBoxHeight, 6).fillAndStroke(hwBg, hwBorder);
        doc
          .fillColor(hwColor)
          .font(fontBold)
          .fontSize(9.5)
          .text(hwTitle, startX + 12, y + 8, { width: pageWidth - 24 });
        if (hwReason) {
          doc
            .font(fontRegular)
            .fontSize(9)
            .text(hwReason, startX + 12, y + 23, { width: pageWidth - 24 });
        }
        y += hwBoxHeight + 14;
      }

      // Section: Errors List
      doc
        .fillColor('#0F172A')
        .font(fontBold)
        .fontSize(12)
        .text('Подробный разбор ошибок и поправок', startX, y, { width: pageWidth });
      y += 20;

      if (confirmedErrors.length === 0) {
        doc
          .roundedRect(startX, y, pageWidth, 42, 6)
          .fillAndStroke('#ECFDF5', '#A7F3D0');
        doc
          .fillColor('#065F46')
          .font(fontRegular)
          .fontSize(10)
          .text(
            'Ошибок в работе не выявлено. Работа выполнена аккуратно и соответствует требованиям.',
            startX + 14,
            y + 14,
            { width: pageWidth - 28 }
          );
        y += 56;
      } else {
        for (let i = 0; i < confirmedErrors.length; i++) {
          const err = confirmedErrors[i];
          const wrongText = cleanText(err.wrongText, '—');
          const correctText = cleanText(err.correctText, '—');
          const explanation = cleanText(err.explanation, '');
          const ruleRef = cleanText(err.ruleRef, '');
          const headerText = `${i + 1}. Строка ${Number(err.lineNumber) || 1} · ${categoryLabelRu(err.category)}: «${wrongText}» → «${correctText}»`;
          const detailText = ruleRef ? `${explanation} (Правило: ${ruleRef})` : explanation;

          const h1 = doc
            .font(fontBold)
            .fontSize(10)
            .heightOfString(headerText, { width: pageWidth - 24 });
          const h2 = detailText
            ? doc
                .font(fontRegular)
                .fontSize(9)
                .heightOfString(detailText, { width: pageWidth - 24 })
            : 0;
          const cardHeight = h1 + h2 + (detailText ? 22 : 16);

          if (y + cardHeight > doc.page.height - doc.page.margins.bottom - 90) {
            doc.addPage();
            y = doc.page.margins.top;
          }

          doc
            .roundedRect(startX, y, pageWidth, cardHeight, 5)
            .fillAndStroke('#FFFFFF', '#E2E8F0');
          doc
            .fillColor('#991B1B')
            .font(fontBold)
            .fontSize(10)
            .text(headerText, startX + 12, y + 8, { width: pageWidth - 24 });
          if (detailText) {
            doc
              .fillColor('#334155')
              .font(fontRegular)
              .fontSize(9)
              .text(detailText, startX + 12, y + 10 + h1 + 2, {
                width: pageWidth - 24,
              });
          }

          y += cardHeight + 8;
        }
        y += 6;
      }

      // Section: Recommendations / Parent Feedback
      const recHeight = doc
        .font(fontRegular)
        .fontSize(10)
        .heightOfString(parentMessage, { width: pageWidth - 28 });
      const recBoxHeight = Math.max(54, recHeight + 28);

      if (y + recBoxHeight + 56 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      doc
        .fillColor('#0F172A')
        .font(fontBold)
        .fontSize(12)
        .text('Рекомендации и комментарий учителя', startX, y, { width: pageWidth });
      y += 20;

      doc
        .roundedRect(startX, y, pageWidth, recBoxHeight, 6)
        .fillAndStroke('#F8FAFC', '#CBD5E1');
      doc
        .fillColor('#1E293B')
        .font(fontRegular)
        .fontSize(10)
        .text(parentMessage, startX + 14, y + 12, { width: pageWidth - 28 });

      // Footer
      const footerY = doc.page.height - doc.page.margins.bottom - 14;
      doc
        .fillColor('#94A3B8')
        .font(fontRegular)
        .fontSize(8.5)
        .text(
          'Сформировано в системе проверки школьных тетрадей «ТетрадьПлюс»',
          startX,
          footerY,
          { width: pageWidth, align: 'center', lineBreak: false }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function buildReportEmailContent(params: {
  parentName?: string;
  report: NotebookReportPayload;
}) {
  const studentName = cleanText(params.report.studentName, 'Ученик');
  const subject = cleanText(params.report.subject, 'Предмет');
  const assignmentTitle = cleanText(
    params.report.assignmentTitle,
    'Проверка тетради'
  );
  const parentName = cleanText(params.parentName, '');
  const teacherName = cleanText(params.report.teacherName, 'Учитель');
  const parentMessage = cleanText(
    params.report.parentMessage,
    'Подробный разбор работы и рекомендации находятся во вложенном PDF-отчёте.'
  );

  const confirmedCount = (
    Array.isArray(params.report.errors) ? params.report.errors : []
  ).filter((e) => e && e.confirmedByTeacher !== false).length;

  const gradeSummary = params.report.isFirstGradeNoGrades
    ? 'Усвоено / Зачёт'
    : `${params.report.contentGrade} (содержание) / ${params.report.calligraphyGrade} (каллиграфия)`;

  const greeting = parentName ? `Здравствуйте, ${parentName}!` : 'Здравствуйте!';
  const safeGreeting = escapeHtml(greeting);
  const safeStudent = escapeHtml(studentName);
  const safeSubject = escapeHtml(subject);
  const safeAssignment = escapeHtml(assignmentTitle);
  const safeGrade = escapeHtml(gradeSummary);
  const safeMessage = escapeHtml(parentMessage).replace(/\n/g, '<br/>');
  const safeTeacher = escapeHtml(teacherName);

  const safeSlug =
    studentName
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'student';

  const asciiSlug =
    studentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'student';

  const mailSubject = `Отчёт о проверке тетради: ${studentName} (${subject})`.replace(
    /[\r\n]+/g,
    ' '
  );

  const textBody = [
    greeting,
    '',
    `Направляем отчёт о проверке тетради ученика: ${studentName}.`,
    `Предмет: ${subject}`,
    `Задание: ${assignmentTitle}`,
    `Отметка: ${gradeSummary}`,
    `Выявлено замечаний: ${confirmedCount}`,
    '',
    'Комментарий учителя:',
    parentMessage,
    '',
    'Подробный разбор ошибок и рекомендации приложены в PDF-файле.',
    `С уважением, ${teacherName}`,
  ].join('\n');

  const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; line-height: 1.5;">
        <p>${safeGreeting}</p>
        <p>Направляем отчёт о проверке тетради ученика <strong>${safeStudent}</strong>.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 12px 0; background: #f8fafc; border: 1px solid #cbd5e1;">
          <tr><td style="padding: 8px 12px; color: #475569;">Предмет:</td><td style="padding: 8px 12px; font-weight: 600;">${safeSubject}</td></tr>
          <tr><td style="padding: 8px 12px; color: #475569;">Задание:</td><td style="padding: 8px 12px;">${safeAssignment}</td></tr>
          <tr><td style="padding: 8px 12px; color: #475569;">Отметка:</td><td style="padding: 8px 12px; font-weight: 700; color: #b91c1c;">${safeGrade}</td></tr>
          <tr><td style="padding: 8px 12px; color: #475569;">Замечаний:</td><td style="padding: 8px 12px;">${confirmedCount}</td></tr>
        </table>
        <div style="padding: 12px; background: #f1f5f9; border-radius: 6px; margin: 12px 0;">
          <strong>Комментарий учителя:</strong><br/>
          ${safeMessage}
        </div>
        <p style="font-size: 13px; color: #475569;">Подробный разбор ошибок и рекомендации приложены во вложении (PDF).</p>
        <p style="font-size: 13px; color: #64748b;">С уважением, ${safeTeacher}</p>
      </div>
    `;

  return {
    mailSubject,
    textBody,
    htmlBody,
    safeSlug,
    asciiSlug,
  };
}

function wrapBase64Lines(b64: string, lineLength = 76): string {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    chunks.push(b64.slice(i, i + lineLength));
  }
  return chunks.join('\r\n');
}

export async function sendParentReportViaGmail(params: {
  gmailAccessToken: string;
  recipientEmail: string;
  parentName?: string;
  report: NotebookReportPayload;
}): Promise<{ messageId: string; pdfBytes: number }> {
  const cleanRecipient = (params.recipientEmail || '')
    .replace(/[\r\n]/g, '')
    .trim();
  if (!isValidEmail(cleanRecipient)) {
    throw new Error('Укажите корректный адрес электронной почты родителя.');
  }

  const cleanToken = (params.gmailAccessToken || '').trim();
  if (!cleanToken) {
    const authErr: any = new Error(
      'Не выполнен вход в Google (Gmail) для отправки письма.'
    );
    authErr.statusCode = 401;
    authErr.requiresGmailAuth = true;
    throw authErr;
  }

  const pdfBuffer = await generateNotebookReportPdf(params.report);
  const content = buildReportEmailContent({
    parentName: params.parentName,
    report: params.report,
  });

  const boundary = `tetradplus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(content.mailSubject, 'utf8').toString('base64')}?=`;
  const htmlBase64 = wrapBase64Lines(
    Buffer.from(content.htmlBody, 'utf8').toString('base64')
  );
  const pdfBase64 = wrapBase64Lines(pdfBuffer.toString('base64'));
  const attachmentName = `report_${content.asciiSlug}.pdf`;

  const rawMime = [
    `To: ${cleanRecipient}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${attachmentName}"`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    'Content-Transfer-Encoding: base64',
    '',
    pdfBase64,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const rawEncoded = Buffer.from(rawMime, 'utf8').toString('base64url');

  const gmailResp = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: rawEncoded }),
    }
  );

  if (!gmailResp.ok) {
    const errPayload: any = await gmailResp.json().catch(() => null);
    const apiMessage =
      errPayload?.error?.message || `Gmail API HTTP ${gmailResp.status}`;

    if (gmailResp.status === 401 || gmailResp.status === 403) {
      const authErr: any = new Error(
        'Доступ к отправке писем через Gmail истёк или не выдан. Подключите Google-аккаунт (Gmail) заново.'
      );
      authErr.statusCode = 401;
      authErr.requiresGmailAuth = true;
      throw authErr;
    }

    const sendErr: any = new Error(
      `Не удалось отправить письмо через Gmail: ${apiMessage}`
    );
    sendErr.statusCode = 502;
    throw sendErr;
  }

  const data: any = await gmailResp.json().catch(() => ({}));
  return {
    messageId: data?.id || 'gmail-sent',
    pdfBytes: pdfBuffer.length,
  };
}

export async function sendParentReportEmail(params: {
  recipientEmail: string;
  parentName?: string;
  report: NotebookReportPayload;
}): Promise<{ messageId: string; pdfBytes: number }> {
  const cleanRecipient = (params.recipientEmail || '').trim();
  if (!isValidEmail(cleanRecipient)) {
    throw new Error('Укажите корректный адрес электронной почты родителя.');
  }

  const smtp = getSmtpConfigFromEnv();
  if (!smtp) {
    const missingErr: any = new Error(
      'Не настроена отправка почты: подключите аккаунт Google (Gmail) в окне отправки отчёта либо задайте параметры SMTP в секретах проекта.'
    );
    missingErr.statusCode = 503;
    missingErr.needsGmailAuth = true;
    throw missingErr;
  }

  const pdfBuffer = await generateNotebookReportPdf(params.report);
  const content = buildReportEmailContent({
    parentName: params.parentName,
    report: params.report,
  });

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const info = await transporter.sendMail({
    from: smtp.from,
    to: cleanRecipient,
    subject: content.mailSubject,
    text: content.textBody,
    html: content.htmlBody,
    attachments: [
      {
        filename: `report_${content.safeSlug}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  return {
    messageId: info.messageId || 'sent',
    pdfBytes: pdfBuffer.length,
  };
}
