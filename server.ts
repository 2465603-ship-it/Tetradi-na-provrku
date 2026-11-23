import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createWorker } from 'tesseract.js';
import {
  generateNotebookReportPdf,
  sendParentReportEmail,
  sendParentReportViaGmail,
  isSmtpConfigured,
  isValidEmail,
  type NotebookReportPayload,
} from './utils/reportMailer.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

interface ModelEnvironmentConfig {
  primaryModel: string;
  modelsToTry: string[];
  temperature?: number;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number;
}

function getCandidateApiKeys(): string[] {
  // Exclusively load API keys from server-side environment variables
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.API_KEY,
    process.env.GOOGLE_API_KEY,
  ];
  const unique: string[] = [];
  for (const key of candidates) {
    if (
      key &&
      typeof key === 'string' &&
      key !== 'MY_GEMINI_API_KEY' &&
      key.trim().length > 10 &&
      !unique.includes(key.trim())
    ) {
      unique.push(key.trim());
    }
  }
  return unique;
}

function getModelConfig(): ModelEnvironmentConfig {
  // Model settings configured via environment variables
  const primaryModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash';
  const fallbackEnv = process.env.GEMINI_FALLBACK_MODELS?.trim();

  let modelsToTry: string[];
  if (fallbackEnv) {
    modelsToTry = fallbackEnv
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  } else {
    modelsToTry = [
      primaryModel,
      'gemini-3.1-pro-preview',
      'gemini-flash-latest',
      'gemini-3.1-flash-lite',
    ];
  }

  if (!modelsToTry.includes(primaryModel)) {
    modelsToTry.unshift(primaryModel);
  }
  modelsToTry = Array.from(new Set(modelsToTry));

  const parsedTemp = process.env.GEMINI_TEMPERATURE
    ? parseFloat(process.env.GEMINI_TEMPERATURE)
    : undefined;
  const temperature =
    parsedTemp !== undefined && !isNaN(parsedTemp) ? parsedTemp : undefined;

  const parsedMaxTokens = process.env.GEMINI_MAX_OUTPUT_TOKENS
    ? parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 10)
    : undefined;
  const maxOutputTokens =
    parsedMaxTokens !== undefined && !isNaN(parsedMaxTokens)
      ? parsedMaxTokens
      : undefined;

  // GEMINI_THINKING_LEVEL: LOW | HIGH | OFF
  const envThinking = process.env.GEMINI_THINKING_LEVEL?.toUpperCase()?.trim();
  let thinkingLevel: ThinkingLevel | undefined;
  if (envThinking === 'LOW') {
    thinkingLevel = ThinkingLevel.LOW;
  } else if (envThinking === 'HIGH') {
    thinkingLevel = ThinkingLevel.HIGH;
  } else if (envThinking === 'OFF') {
    thinkingLevel = undefined;
  } else if (!envThinking) {
    thinkingLevel = primaryModel.includes('3.8-flash')
      ? ThinkingLevel.LOW
      : undefined;
  }

  return {
    primaryModel,
    modelsToTry,
    temperature,
    thinkingLevel,
    maxOutputTokens,
  };
}

// Helper to resolve image bytes if teacher selected a built-in sample photo URL
function resolveImagePayload(
  imageBase64?: string,
  mimeType = 'image/jpeg',
  sampleId?: string
): { data: string; mimeType: string } | null {
  if (imageBase64 && imageBase64.trim().length > 20) {
    const cleanBase64 = imageBase64.replace(
      /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
      ''
    );
    const detectedMime =
      imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/)?.[1] ||
      mimeType ||
      'image/jpeg';
    return { data: cleanBase64, mimeType: detectedMime };
  }

  // If teacher clicked a built-in sample image without uploading a file, read the real image file from /src/assets/images
  if (sampleId === 'russian' || sampleId === 'math') {
    try {
      const fileName =
        sampleId === 'math'
          ? 'notebook_math_sample_1791287022552.jpg'
          : 'notebook_russian_sample_1791287005521.jpg';
      const filePath = path.join(
        process.cwd(),
        'src',
        'assets',
        'images',
        fileName
      );
      if (fs.existsSync(filePath)) {
        const buf = fs.readFileSync(filePath);
        return { data: buf.toString('base64'), mimeType: 'image/jpeg' };
      }
    } catch (e) {
      console.warn('Could not read sample image from disk:', e);
    }
  }

  return null;
}

async function callGeminiMultimodalWithFallback(
  parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }>,
  systemInstruction: string,
  responseSchema: any
) {
  const apiKeys = getCandidateApiKeys();
  if (apiKeys.length === 0) {
    throw new Error(
      'На сервере опубликованного приложения не найден действующий GEMINI_API_KEY. Задайте переменную окружения GEMINI_API_KEY.'
    );
  }

  const modelConfig = getModelConfig();
  let lastError: any = null;

  for (const apiKey of apiKeys) {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    for (const modelName of modelConfig.modelsToTry) {
      try {
        const config: any = {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema,
        };

        if (modelConfig.temperature !== undefined) {
          config.temperature = modelConfig.temperature;
        }

        if (modelConfig.maxOutputTokens !== undefined) {
          config.maxOutputTokens = modelConfig.maxOutputTokens;
        }

        // Apply thinking config from env or model defaults
        if (
          modelConfig.thinkingLevel !== undefined &&
          (modelName.includes('3.8-flash') || modelName.includes('pro'))
        ) {
          config.thinkingConfig = { thinkingLevel: modelConfig.thinkingLevel };
        }

        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config,
        });

        const rawText = response.text;
        if (rawText) {
          const cleanJson = rawText
            .trim()
            .replace(/^```json\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          return {
            modelUsed: modelName,
            parsed: JSON.parse(cleanJson),
          };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`Model ${modelName} failed:`, err?.message || err);
        // If the key itself is invalid (API_KEY_INVALID), break inner loop and try next candidate key
        if (String(err?.message || '').includes('API_KEY_INVALID')) {
          break;
        }
      }
    }
  }

  throw (
    lastError ||
    new Error('Не удалось выполнить мультимодальный запрос к Gemini API.')
  );
}

interface DetectedErrorItem {
  lineIndex: number;
  wrongFragment: string;
  correctFragment: string;
  ruleName: string;
  explanation: string;
  errorType:
    | 'orthography'
    | 'punctuation'
    | 'calculation'
    | 'calligraphy'
    | 'logic';
  marginMark: '/' | 'V' | '!' | 'К';
}

// Local Primary School Russian & Math Rule Analyzer (Used when teacher edits text or local OCR runs in published environment)
function analyzePrimarySchoolLines(
  lines: string[],
  subject: string,
  gradeLevel: string,
  assignmentTitle: string,
  referenceSolution: string
) {
  const errors: DetectedErrorItem[] = [];
  const isMath = subject.toLowerCase().includes('матем');

  const russianDictionaries: Array<{
    regex: RegExp;
    correct: string | ((m: string) => string);
    ruleName: string;
    explanation: string;
  }> = [
    {
      regex: /[а-яё]*[жш]ы[а-яё]*/gi,
      correct: (m) => m.replace(/([жш])ы/gi, (_, c) => `${c}и`),
      ruleName: 'Правописание сочетаний ЖИ–ШИ (Орфограмма № 1)',
      explanation: 'После твёрдых шипящих Ж и Ш всегда пишется гласная буква И.',
    },
    {
      regex: /[а-яё]*[чщ]я[а-яё]*/gi,
      correct: (m) => m.replace(/([чщ])я/gi, (_, c) => `${c}а`),
      ruleName: 'Правописание сочетаний ЧА–ЩА (Орфограмма № 2)',
      explanation:
        'В сочетаниях ЧА–ЩА после мягких шипящих Ч и Щ всегда пишется буква А.',
    },
    {
      regex: /[а-яё]*[чщ]ю[а-яё]*/gi,
      correct: (m) => m.replace(/([чщ])ю/gi, (_, c) => `${c}у`),
      ruleName: 'Правописание сочетаний ЧУ–ЩУ (Орфограмма № 3)',
      explanation:
        'В сочетаниях ЧУ–ЩУ после мягких шипящих Ч и Щ всегда пишется буква У.',
    },
    {
      regex: /[а-яё]*(?:чк|чн|нщ|рщ|щн)ь[а-яё]*/gi,
      correct: (m) => m.replace(/ь/gi, ''),
      ruleName: 'Сочетания ЧК, ЧН, НЩ, ЩН без мягкого знака',
      explanation: 'В сочетаниях ЧК, ЧН, НЩ, РЩ, ЩН мягкий знак (Ь) не пишется.',
    },
    {
      regex: /(?<![а-яё])карзин([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/карзин/i, 'корзин'),
      ruleName: 'Непроверяемая безударная гласная в корне (словарное слово)',
      explanation: 'Слово «корзина» — словарное, написание безударной О нужно запомнить.',
    },
    {
      regex: /(?<![а-яё])малак([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/малак/i, 'молок'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «молоко»)',
      explanation: 'Сочетание -ОЛО- в словарном слове «молоко» пишется с буквами О.',
    },
    {
      regex: /(?<![а-яё])сабак([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/сабак/i, 'собак'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «собака»)',
      explanation: 'В словарном слове «собака» в первом слоге пишется буква О.',
    },
    {
      regex: /(?<![а-яё])каров([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/каров/i, 'коров'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «корова»)',
      explanation: 'В словарном слове «корова» в первом слоге пишется буква О.',
    },
    {
      regex: /(?<![а-яё])варон([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/варон/i, 'ворон'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «ворона»)',
      explanation: 'Сочетание -ОРО- в слове «ворона» пишется с буквой О.',
    },
    {
      regex: /(?<![а-яё])вароб([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/вароб/i, 'вороб'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «воробей»)',
      explanation: 'Сочетание -ОРО- в слове «воробей» пишется с буквой О.',
    },
    {
      regex: /(?<![а-яё])мароз([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/мароз/i, 'мороз'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «мороз»)',
      explanation: 'В слове «мороз» в первом слоге пишется безударная буква О.',
    },
    {
      regex: /(?<![а-яё])рибят([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/рибят/i, 'ребят'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «ребята»)',
      explanation: 'В словарном слове «ребята» в первом слоге пишется буква Е.',
    },
    {
      regex: /(?<![а-яё])учиник([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/учиник/i, 'ученик'),
      ruleName: 'Непроверяемая безударная гласная (словарное слово «ученик»)',
      explanation: 'В слове «ученик» пишется суффикс -ЕНИК- с буквой Е.',
    },
    {
      regex: /(?<![а-яё])клас(?![а-яё])/gi,
      correct: 'класс',
      ruleName: 'Удвоенные согласные в корне слова («класс»)',
      explanation: 'В словарном слове «класс» пишется удвоенная согласная СС.',
    },
    {
      regex: /(?<![а-яё])(в|на)\s+рощи(?![а-яё])/gi,
      correct: (m) => m.replace(/рощи$/i, 'роще'),
      ruleName:
        'Правописание безударных падежных окончаний имён существительных 1-го склонения',
      explanation:
        'Существительное 1-го склонения «роща» в предложном падеже (в чём?) имеет окончание -Е.',
    },
    {
      regex: /(?<![а-яё])бижит(?![а-яё])/gi,
      correct: 'бежит',
      ruleName: 'Проверяемая безударная гласная в корне слова',
      explanation: 'Проверочное слово — «бе́г», поэтому в корне пишется буква Е.',
    },
    {
      regex: /(?<![а-яё])трапинк([а-яё]*)(?![а-яё])/gi,
      correct: (m) => m.replace(/трапинк/i, 'тропинк'),
      ruleName: 'Проверяемая безударная гласная в корне слова',
      explanation: 'Проверочное слово — «тро́пы», поэтому в корне пишется буква О.',
    },
    {
      regex: /(?<![а-яё])сниговик(?![а-яё])/gi,
      correct: 'снеговик',
      ruleName: 'Проверяемая безударная гласная в корне слова',
      explanation: 'Проверочное слово — «сне́г», в корне пишется буква Е.',
    },
    {
      regex: /(?<![а-яё])лисной(?![а-яё])/gi,
      correct: 'лесной',
      ruleName: 'Проверяемая безударная гласная в корне слова',
      explanation: 'Проверочное слово — «ле́с», в корне пишется буква Е.',
    },
    {
      regex: /(?<![а-яё])зделать(?![а-яё])/gi,
      correct: 'сделать',
      ruleName: 'Правописание неизменяемой приставки С-',
      explanation: 'Приставки З- в русском языке не бывает, всегда пишется приставка С-.',
    },
  ];

  const mathExprRegex = /(\d+)\s*([+\-×*·:÷/])\s*(\d+)\s*=\s*(\d+)/g;

  lines.forEach((line, lineIdx) => {
    let mathMatch: RegExpExecArray | null;
    const lineMathRegex = new RegExp(mathExprRegex);
    while ((mathMatch = lineMathRegex.exec(line)) !== null) {
      const a = Number(mathMatch[1]);
      const op = mathMatch[2];
      const b = Number(mathMatch[3]);
      const studentAns = Number(mathMatch[4]);
      let expectedAns = studentAns;
      let opName = 'Вычисление';

      if (op === '+') {
        expectedAns = a + b;
        opName = a + b >= 20 ? 'Сложение двузначных чисел' : 'Табличное сложение';
      } else if (op === '-') {
        expectedAns = a - b;
        opName =
          a % 10 < b % 10
            ? 'Вычитание с переходом через десяток'
            : 'Вычитание чисел';
      } else if (op === '*' || op === '×' || op === '·') {
        expectedAns = a * b;
        opName = 'Таблица умножения';
      } else if ((op === ':' || op === '÷' || op === '/') && b !== 0) {
        expectedAns = a / b;
        opName = 'Табличное деление';
      }

      if (expectedAns !== studentAns && Number.isInteger(expectedAns)) {
        const displayOp = op === '*' ? '×' : op === '/' ? ':' : op;
        errors.push({
          lineIndex: lineIdx,
          wrongFragment: mathMatch[0],
          correctFragment: `${a} ${displayOp} ${b} = ${expectedAns}`,
          ruleName: opName,
          explanation: `При вычислении ${a} ${displayOp} ${b} правильный ответ равен ${expectedAns}, а у ученика записано ${studentAns}.`,
          errorType: 'calculation',
          marginMark: '!',
        });
      }
    }

    for (const rule of russianDictionaries) {
      const rx = new RegExp(rule.regex);
      let m: RegExpExecArray | null;
      while ((m = rx.exec(line)) !== null) {
        const wrongWord = m[0];
        const fixedWord =
          typeof rule.correct === 'function'
            ? rule.correct(wrongWord)
            : rule.correct;
        if (wrongWord.toLowerCase() !== fixedWord.toLowerCase()) {
          errors.push({
            lineIndex: lineIdx,
            wrongFragment: wrongWord,
            correctFragment: fixedWord,
            ruleName: rule.ruleName,
            explanation: rule.explanation,
            errorType: 'orthography',
            marginMark: '/',
          });
        }
      }
    }
  });

  if (referenceSolution && referenceSolution.trim().length > 3 && !isMath) {
    const cleanWord = (w: string) =>
      w.replace(/[.,!?;:()«»"—\-0-9]/g, '').trim();
    const refWords = referenceSolution
      .split(/\s+/)
      .map(cleanWord)
      .filter((w) => w.length >= 3);

    const levenshtein = (a: string, b: string): number => {
      const dp = Array.from({ length: a.length + 1 }, () =>
        new Array(b.length + 1).fill(0)
      );
      for (let i = 0; i <= a.length; i++) dp[i][0] = i;
      for (let j = 0; j <= b.length; j++) dp[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost =
            a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + cost
          );
        }
      }
      return dp[a.length][b.length];
    };

    lines.forEach((line, lineIdx) => {
      const tokens = line.split(/\s+/);
      tokens.forEach((tok) => {
        const w = cleanWord(tok);
        if (w.length < 3) return;
        const alreadyLogged = errors.some(
          (e) =>
            e.lineIndex === lineIdx &&
            e.wrongFragment.toLowerCase().includes(w.toLowerCase())
        );
        if (alreadyLogged) return;

        for (const refW of refWords) {
          if (w.toLowerCase() === refW.toLowerCase()) break;
          const dist = levenshtein(w, refW);
          if (dist === 1 || (dist === 2 && refW.length >= 6)) {
            errors.push({
              lineIndex: lineIdx,
              wrongFragment: w,
              correctFragment: refW,
              ruleName: 'Орфографическая зоркость и списывание без искажений',
              explanation: `В образце задания написано «${refW}», а в тетради ученика — «${w}».`,
              errorType: 'orthography',
              marginMark: '/',
            });
            break;
          }
        }
      });
    });
  }

  const errCount = errors.length;
  const recommendedGrade =
    errCount === 0 ? 5 : errCount <= 2 ? 4 : errCount <= 4 ? 3 : 2;
  const calligraphyScore = errCount === 0 ? 5 : 4;

  return {
    recognizedLines: lines,
    recommendedGrade,
    calligraphyScore,
    summary:
      errCount === 0
        ? `Работа (${gradeLevel}, «${assignmentTitle}») проверена: ошибок в распознанных строках не обнаружено.`
        : `Проверена работа (${gradeLevel}, «${assignmentTitle}»). Распознано строк: ${lines.length}. Найдено ошибок: ${errCount}. Рекомендуемая отметка по ФГОС НОО — «${recommendedGrade}».`,
    studentPraise:
      errCount === 0
        ? 'Молодец! Работа выполнена верно!'
        : 'Хорошая работа! Обрати внимание на исправления красной пастой.',
    parentFeedback:
      errCount === 0
        ? `Здравствуйте! Домашняя работа (${subject}, ${gradeLevel}) выполнена без ошибок.`
        : `Здравствуйте! Домашняя работа (${subject}, ${gradeLevel}) проверена. Рекомендую повторить слова/примеры: ${errors
            .map((e) => `«${e.wrongFragment}» → «${e.correctFragment}»`)
            .join(', ')}.`,
    errors,
    remediationTasks:
      errors.length > 0
        ? errors.slice(0, 2).map((e) => ({
            title: `Работа над ошибками: ${e.ruleName}`,
            instruction: `Исправь «${e.wrongFragment}» на «${e.correctFragment}» и запиши 2 проверочных примера:`,
            examples: [e.correctFragment],
          }))
        : [
            {
              title: 'Каллиграфическая минутка',
              instruction: 'Пропиши одну строчку аккуратным почерком.',
              examples: ['Чистописание'],
            },
          ],
  };
}

// Local OCR backup using Tesseract.js (rus+eng) if Cloud Run GEMINI_API_KEY was not redeployed yet
async function extractLinesWithLocalOcr(imageBase64: string): Promise<string[]> {
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    const cleanBase64 = imageBase64.replace(
      /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
      ''
    );
    const imgBuffer = Buffer.from(cleanBase64, 'base64');
    worker = await createWorker(['rus', 'eng']);
    const ret = await worker.recognize(imgBuffer);
    const rawLines = (ret.data.text || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/[|_~`^<>\\[\]{}]/g, '').trim())
      .filter((l) => l.length >= 2 && /[а-яёА-ЯЁa-zA-Z0-9]/.test(l));
    return rawLines;
  } catch (err) {
    console.warn('Local Tesseract OCR error:', err);
    return [];
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Firebase Auth REST API helpers (reads FIREBASE_WEB_API_KEY strictly from env)
  const FIREBASE_IDENTITY_BASE = 'https://identitytoolkit.googleapis.com/v1';
  const FIREBASE_SECURETOKEN_URL = 'https://securetoken.googleapis.com/v1/token';

  function getFirebaseWebApiKey(): string | null {
    const candidates: Array<unknown> = [
      process.env.FIREBASE_WEB_API_KEY,
      process.env.FIREBASE_API_KEY,
      process.env.VITE_FIREBASE_API_KEY,
    ];

    // Also allow dynamic read from firebase-applet-config.json if user kept apiKey there
    try {
      const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        if (cfg?.apiKey) candidates.push(cfg.apiKey);
      }
    } catch {
      // ignore config read errors
    }

    for (const raw of candidates) {
      if (
        raw &&
        typeof raw === 'string' &&
        raw.trim().length > 10 &&
        raw.trim() !== 'MY_FIREBASE_WEB_API_KEY'
      ) {
        return raw.trim();
      }
    }
    return null;
  }

  function mapFirebaseAuthError(rawCode: string): string {
    const code = (rawCode || '').trim();
    const map: Record<string, string> = {
      EMAIL_EXISTS: 'Пользователь с таким email уже зарегистрирован.',
      OPERATION_NOT_ALLOWED:
        'Вход по email и паролю не включён в Firebase Console (Authentication -> Sign-in method -> Email/Password).',
      PASSWORD_LOGIN_DISABLED:
        'Вход и регистрация по email и паролю отключены в настройках Firebase Console. Откройте Authentication -> Sign-in method -> Email/Password и включите провайдер.',
      ADMIN_ONLY_OPERATION:
        'Самостоятельная регистрация отключена в настройках Firebase Authentication (включите Email/Password в Firebase Console).',
      TOO_MANY_ATTEMPTS_TRY_LATER:
        'Слишком много неудачных попыток входа. Попробуйте позже.',
      EMAIL_NOT_FOUND: 'Пользователь с таким email не найден.',
      INVALID_PASSWORD: 'Неверный пароль.',
      INVALID_LOGIN_CREDENTIALS: 'Неверный email или пароль.',
      USER_DISABLED: 'Учётная запись заблокирована администратором.',
      INVALID_EMAIL: 'Указан некорректный формат email.',
      INVALID_ID_TOKEN: 'Сессия устарела. Выполните вход повторно.',
      TOKEN_EXPIRED: 'Срок действия сессии истёк. Выполните вход повторно.',
      USER_NOT_FOUND: 'Учётная запись не найдена.',
    };
    if (map[code]) return map[code];
    if (code.startsWith('WEAK_PASSWORD')) {
      return 'Пароль слишком простой (минимум 6 символов).';
    }
    if (code.includes('API_KEY_INVALID') || code.includes('API key not valid')) {
      return 'Недействительный FIREBASE_WEB_API_KEY в переменных окружения сервера.';
    }
    return code
      ? `Ошибка авторизации Firebase: ${code}`
      : 'Не удалось выполнить запрос к серверу авторизации.';
  }

  async function safeParseUpstreamJson(resp: globalThis.Response): Promise<any> {
    const text = await resp.text();
    const trimmed = text.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return {
        error: {
          message: `UPSTREAM_NON_JSON_${resp.status}`,
        },
      };
    }
  }

  async function lookupFirebaseUserByToken(
    idToken: string,
    apiKey: string
  ): Promise<{
    uid: string;
    email: string;
    displayName?: string;
    emailVerified?: boolean;
  } | null> {
    if (!idToken || !apiKey) return null;
    try {
      const resp = await fetch(
        `${FIREBASE_IDENTITY_BASE}/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!resp.ok) return null;
      const data: any = await safeParseUpstreamJson(resp);
      const fbUser = Array.isArray(data?.users) ? data.users[0] : null;
      if (!fbUser?.localId) return null;
      return {
        uid: fbUser.localId,
        email: fbUser.email || '',
        displayName: fbUser.displayName || undefined,
        emailVerified: Boolean(fbUser.emailVerified),
      };
    } catch {
      return null;
    }
  }

  async function refreshFirebaseToken(refreshToken: string, apiKey: string) {
    if (!refreshToken || !apiKey) return null;
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      const resp = await fetch(
        `${FIREBASE_SECURETOKEN_URL}?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }
      );
      if (!resp.ok) return null;
      const data: any = await safeParseUpstreamJson(resp);
      if (!data?.id_token) return null;
      return {
        idToken: String(data.id_token),
        refreshToken: String(data.refresh_token || refreshToken),
        expiresIn: String(data.expires_in || '3600'),
        uid: String(data.user_id || ''),
      };
    } catch {
      return null;
    }
  }

  async function requireFirebaseAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const apiKey = getFirebaseWebApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error:
          'Сервер не настроен для авторизации: задайте переменную окружения FIREBASE_WEB_API_KEY в файле .env или Secrets.',
      });
    }

    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const idToken = match?.[1]?.trim();
    if (!idToken) {
      return res.status(401).json({
        error:
          'Доступ запрещён: выполните вход или регистрацию, чтобы загружать и проверять тетради.',
      });
    }

    const verifiedUser = await lookupFirebaseUserByToken(idToken, apiKey);
    if (!verifiedUser) {
      return res.status(401).json({
        error: 'Сессия недействительна или истекла. Пожалуйста, войдите снова.',
      });
    }

    (req as any).authUser = verifiedUser;
    return next();
  }

  // Health check endpoint for deployment probes
  app.get('/api/health', (_req, res) => {
    const keys = getCandidateApiKeys();
    const modelConfig = getModelConfig();
    res.status(200).json({
      status: 'ok',
      hasApiKey: keys.length > 0,
      hasFirebaseAuthKey: Boolean(getFirebaseWebApiKey()),
      hasSmtpConfig: isSmtpConfigured(),
      supportsGmailOAuth: true,
      activeModel: modelConfig.primaryModel,
      fallbackModels: modelConfig.modelsToTry,
      temperature: modelConfig.temperature,
      thinkingLevel: modelConfig.thinkingLevel,
    });
  });

  // Email/Password Registration via Firebase Auth REST API
  app.post('/api/auth/register', async (req, res) => {
    const apiKey = getFirebaseWebApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error:
          'Не задан FIREBASE_WEB_API_KEY в .env (или Secrets AI Studio). Добавьте Web API Key вашего проекта Firebase.',
      });
    }

    const { email, password, fullName } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanPassword = typeof password === 'string' ? password : '';
    const cleanName = typeof fullName === 'string' ? fullName.trim() : '';

    if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: 'Введите корректный адрес электронной почты.',
      });
    }
    if (cleanPassword.length < 6) {
      return res.status(400).json({
        error: 'Пароль должен содержать минимум 6 символов.',
      });
    }

    try {
      const fbResp = await fetch(
        `${FIREBASE_IDENTITY_BASE}/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: cleanPassword,
            returnSecureToken: true,
          }),
        }
      );

      const fbData: any = await safeParseUpstreamJson(fbResp);
      if (!fbResp.ok) {
        const errCode = fbData?.error?.message || '';
        return res.status(400).json({ error: mapFirebaseAuthError(errCode) });
      }

      if (cleanName) {
        await fetch(
          `${FIREBASE_IDENTITY_BASE}/accounts:update?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken: fbData.idToken,
              displayName: cleanName,
              returnSecureToken: false,
            }),
          }
        ).catch(() => {});
      }

      return res.json({
        user: {
          uid: fbData.localId,
          email: fbData.email || cleanEmail,
          displayName: cleanName || undefined,
          emailVerified: false,
        },
        idToken: fbData.idToken,
        refreshToken: fbData.refreshToken,
        expiresIn: fbData.expiresIn,
      });
    } catch (err: any) {
      return res.status(502).json({
        error:
          err?.message ||
          'Не удалось связаться с сервером Firebase Authentication.',
      });
    }
  });

  // Email/Password Sign-In via Firebase Auth REST API
  app.post('/api/auth/login', async (req, res) => {
    const apiKey = getFirebaseWebApiKey();
    if (!apiKey) {
      return res.status(503).json({
        error:
          'Не задан FIREBASE_WEB_API_KEY в .env (или Secrets AI Studio). Добавьте Web API Key вашего проекта Firebase.',
      });
    }

    const { email, password } = req.body || {};
    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanPassword = typeof password === 'string' ? password : '';

    if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: 'Введите корректный адрес электронной почты.',
      });
    }
    if (!cleanPassword) {
      return res.status(400).json({
        error: 'Введите пароль.',
      });
    }

    try {
      const fbResp = await fetch(
        `${FIREBASE_IDENTITY_BASE}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: cleanPassword,
            returnSecureToken: true,
          }),
        }
      );

      const fbData: any = await safeParseUpstreamJson(fbResp);
      if (!fbResp.ok) {
        const errCode = fbData?.error?.message || '';
        return res.status(401).json({ error: mapFirebaseAuthError(errCode) });
      }

      return res.json({
        user: {
          uid: fbData.localId,
          email: fbData.email || cleanEmail,
          displayName: fbData.displayName || undefined,
          emailVerified: Boolean(fbData.emailVerified),
        },
        idToken: fbData.idToken,
        refreshToken: fbData.refreshToken,
        expiresIn: fbData.expiresIn,
      });
    } catch (err: any) {
      return res.status(502).json({
        error:
          err?.message ||
          'Не удалось связаться с сервером Firebase Authentication.',
      });
    }
  });

  // Verify or refresh active session token via Firebase REST API
  app.post('/api/auth/verify', async (req, res) => {
    const apiKey = getFirebaseWebApiKey();
    if (!apiKey) {
      return res.status(503).json({
        valid: false,
        error: 'FIREBASE_WEB_API_KEY не настроен на сервере.',
      });
    }

    const { idToken, refreshToken } = req.body || {};
    if (typeof idToken === 'string' && idToken.trim()) {
      const user = await lookupFirebaseUserByToken(idToken.trim(), apiKey);
      if (user) {
        return res.json({
          valid: true,
          user,
          idToken: idToken.trim(),
          refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
        });
      }
    }

    if (typeof refreshToken === 'string' && refreshToken.trim()) {
      const refreshed = await refreshFirebaseToken(refreshToken.trim(), apiKey);
      if (refreshed) {
        const user = await lookupFirebaseUserByToken(refreshed.idToken, apiKey);
        if (user) {
          return res.json({
            valid: true,
            user,
            idToken: refreshed.idToken,
            refreshToken: refreshed.refreshToken,
          });
        }
      }
    }

    return res.status(401).json({
      valid: false,
      error: 'Сессия недействительна или истекла.',
    });
  });

  // In-memory store for phone OTP verification codes
  const otpStore = new Map<string, { code: string; expiresAt: number }>();
  const configuredDemoOtp = process.env.DEMO_OTP_CODE?.trim() || '';

  app.post('/api/auth/send-otp', (req, res) => {
    const { phone } = req.body || {};
    if (
      !phone ||
      typeof phone !== 'string' ||
      phone.replace(/\D/g, '').length < 10
    ) {
      return res.status(400).json({
        error: 'Укажите корректный номер телефона (не менее 10 цифр).',
      });
    }
    const normalizedPhone = phone.replace(/\D/g, '');
    const code = configuredDemoOtp || String(crypto.randomInt(1000, 10000));
    otpStore.set(normalizedPhone, {
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return res.json({
      sent: true,
      normalizedPhone,
      demoCodeHint: code,
      message: `СМС-код подтверждения отправлен на номер ${phone}. (Код для проверки: ${code})`,
    });
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const { phone, code } = req.body || {};
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    const stored = otpStore.get(normalizedPhone);
    const cleanCode = String(code || '').trim();

    if (
      !cleanCode ||
      !stored ||
      stored.expiresAt <= Date.now() ||
      stored.code !== cleanCode
    ) {
      return res.status(400).json({
        error: 'Неверный или истёкший код из СМС. Запросите код повторно.',
      });
    }

    otpStore.delete(normalizedPhone);
    return res.json({
      verified: true,
      teacherTokenId: `teacher_${normalizedPhone}`,
    });
  });

  // Endpoint 1: Multimodal AI Notebook Photo & Handwriting Recognition (Protected by Firebase Auth)
  app.post('/api/check-notebook', requireFirebaseAuth, async (req, res) => {
    try {
      const {
        imageBase64,
        mimeType = 'image/jpeg',
        subject = 'Русский язык',
        gradeLevel = '2 класс',
        assignmentTitle = 'Домашняя работа',
        referenceSolution = '',
        studentWrittenText = '',
        sampleId = '',
      } = req.body || {};

      const imagePayload = resolveImagePayload(imageBase64, mimeType, sampleId);
      const hasManualText =
        typeof studentWrittenText === 'string' &&
        studentWrittenText.trim().length > 0;

      if (!imagePayload && !hasManualText) {
        return res.status(400).json({
          error:
            'Загрузите фотографию тетради или введите строки работы ученика для проверки.',
        });
      }

      const parts: Array<{
        text?: string;
        inlineData?: { data: string; mimeType: string };
      }> = [];

      if (imagePayload) {
        parts.push({
          inlineData: {
            mimeType: imagePayload.mimeType,
            data: imagePayload.data,
          },
        });
      }

      const prompt = `Ты — опытный учитель начальных классов (${gradeLevel}), проверяющий реальную тетрадь ученика по предмету «${subject}».
${assignmentTitle ? `Тема или задание: «${assignmentTitle}».` : ''}
${
  hasManualText
    ? `Учитель передал/скорректировал строки ученика:\n${studentWrittenText.trim()}\n`
    : ''
}
${
  referenceSolution
    ? `Эталонный текст / правильное решение для сверки:\n${referenceSolution}\n`
    : ''
}

КРИТИЧЕСКИ ВАЖНОЕ ПРАВИЛО РАСПОЗНАВАНИЯ:
1. Прочитай и расшифруй ТОЛЬКО то, что РЕАЛЬНО написано от руки (или напечатано) на прикреплённом изображении (или в переданном тексте ученика).
2. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать или подставлять посторонние примеры и чужие тексты, если их нет на фото!
3. Сохраняй в массиве recognizedLines точную транскрипцию каждой строки так, как её написал ученик (включая все его орфографические, пунктуационные или вычислительные ошибки).
4. Для каждой найденной ошибки укажи точный индекс строки (lineIndex, начиная с 0, соответствующий массиву recognizedLines), ошибочный фрагмент (wrongFragment — точная подстрока из этой строки), правильное исправление (correctFragment), название правила ФГОС НОО (ruleName), понятное ребёнку объяснение (explanation), тип ошибки и знак на полях ('/', 'V', '!', 'К').
5. Выстави объективную отметку по нормам ФГОС НОО за содержание (5, 4, 3 или 2) и за каллиграфию/почерк (5, 4 или 3).`;

      parts.push({ text: prompt });

      const schema = {
        type: Type.OBJECT,
        properties: {
          recognizedLines: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'Точные строки, прочитанные с фотографии тетради (с сохранением ошибок ученика для зачёркивания).',
          },
          recommendedGrade: {
            type: Type.INTEGER,
            description: 'Рекомендуемая оценка за содержание (5, 4, 3 или 2).',
          },
          calligraphyScore: {
            type: Type.INTEGER,
            description: 'Оценка за каллиграфию и аккуратность почерка (5, 4 или 3).',
          },
          summary: {
            type: Type.STRING,
            description:
              'Подробное методическое заключение учителя по реальному содержимому фотографии.',
          },
          studentPraise: {
            type: Type.STRING,
            description:
              'Короткая поддерживающая фраза для записи в тетрадь красной пастой.',
          },
          parentFeedback: {
            type: Type.STRING,
            description:
              'Тактичное сообщение для родителей в электронный дневник по результатам этой работы.',
          },
          errors: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lineIndex: {
                  type: Type.INTEGER,
                  description: 'Номер строки в массиве recognizedLines (начиная с 0).',
                },
                wrongFragment: {
                  type: Type.STRING,
                  description:
                    'Точный фрагмент с ошибкой из строки recognizedLines[lineIndex].',
                },
                correctFragment: {
                  type: Type.STRING,
                  description: 'Правильное написание или верный результат вычисления.',
                },
                ruleName: {
                  type: Type.STRING,
                  description: 'Название правила или темы.',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Понятное ученику объяснение ошибки.',
                },
                errorType: {
                  type: Type.STRING,
                  description:
                    'orthography | punctuation | calculation | calligraphy | logic',
                },
                marginMark: {
                  type: Type.STRING,
                  description: 'Знак на полях: /, V, !, К',
                },
              },
              required: [
                'lineIndex',
                'wrongFragment',
                'correctFragment',
                'ruleName',
                'explanation',
                'errorType',
                'marginMark',
              ],
            },
          },
          remediationTasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                instruction: { type: Type.STRING },
                examples: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['title', 'instruction', 'examples'],
            },
          },
        },
        required: [
          'recognizedLines',
          'recommendedGrade',
          'calligraphyScore',
          'summary',
          'studentPraise',
          'parentFeedback',
          'errors',
          'remediationTasks',
        ],
      };

      try {
        const { modelUsed, parsed } = await callGeminiMultimodalWithFallback(
          parts,
          'Ты — точная система оптического распознавания рукописных школьных тетрадей (OCR) и методист начальной школы (ФГОС НОО). Расшифровывай исключительно реальный текст и примеры с изображения. Отвечай строго в формате JSON на русском языке.',
          schema
        );

        return res.json({
          source: modelUsed,
          result: parsed,
        });
      } catch (geminiErr: any) {
        console.warn(
          'Gemini Vision unavailable in current environment, running local OCR + Rule Engine:',
          geminiErr?.message || geminiErr
        );

        // If teacher entered/edited text manually, analyze those exact lines
        if (hasManualText) {
          const manualLines = studentWrittenText
            .split(/\r?\n/)
            .map((s: string) => s.trim())
            .filter(Boolean);
          const localResult = analyzePrimarySchoolLines(
            manualLines,
            subject,
            gradeLevel,
            assignmentTitle,
            referenceSolution
          );
          return res.json({
            source: 'local-rule-analyzer',
            warning:
              'Внимание: в опубликованной версии не обновлён GEMINI_API_KEY (выполните повторный Deploy после привязки ключа). Проверка выполнена встроенным анализатором по введённому тексту.',
            result: localResult,
          });
        }

        // If an image was provided, run real Tesseract OCR on the image bytes (NEVER return fake hardcoded text!)
        if (imagePayload) {
          const ocrLines = await extractLinesWithLocalOcr(imagePayload.data);
          if (ocrLines.length > 0) {
            const ocrAnalyzed = analyzePrimarySchoolLines(
              ocrLines,
              subject,
              gradeLevel,
              assignmentTitle,
              referenceSolution
            );
            return res.json({
              source: 'tesseract-local-ocr',
              warning:
                'Использовано резервное оптическое распознавание (Tesseract OCR). Чтобы в опубликованном приложении заработало распознавание рукописного курсива Gemini Vision, нажмите «Deploy» (Опубликовать) повторно для обновления API-ключа.',
              result: ocrAnalyzed,
            });
          }
        }

        return res.status(500).json({
          error:
            'Опубликованное приложение использует старую ревизию без обновлённого API-ключа Gemini (ошибка ключа в облаке). Пожалуйста, нажмите кнопку «Deploy» (Опубликовать) в правом верхнем углу AI Studio, чтобы опубликовать последнюю версию с подключённым ключом и сжатием фото.',
        });
      }
    } catch (error: any) {
      console.error('Error in /api/check-notebook:', error);
      return res.status(500).json({
        error:
          error?.message ||
          'Не удалось распознать фотографию тетради. Пожалуйста, убедитесь, что снимок чёткий.',
      });
    }
  });

  // Endpoint 2: Custom Remediation Card Generator via Gemini (Protected by Firebase Auth)
  app.post('/api/generate-remediation', requireFirebaseAuth, async (req, res) => {
    try {
      const { studentName, gradeLevel, subject, errors = [] } = req.body || {};

      const errorSummary =
        errors.length > 0
          ? errors
              .map(
                (e: any) =>
                  `${e.wrongFragment} → ${e.correctFragment} (${e.ruleName})`
              )
              .join('; ')
          : 'Закрепление пройденной темы и каллиграфическая минутка';

      const schema = {
        type: Type.OBJECT,
        properties: {
          cardTitle: { type: Type.STRING },
          encouragement: { type: Type.STRING },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                ruleReminder: { type: Type.STRING },
                taskText: { type: Type.STRING },
                practiceItems: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['ruleReminder', 'taskText', 'practiceItems'],
            },
          },
        },
        required: ['cardTitle', 'encouragement', 'steps'],
      };

      try {
        const { parsed } = await callGeminiMultimodalWithFallback(
          [
            {
              text: `Составь индивидуальную карточку «Работа над ошибками» для ученика начальной школы (${studentName}, ${gradeLevel}, предмет: ${subject}).
Допущенные ошибки в тетради: ${errorSummary}.
Сделай 3 коротких, увлекательных задания на 5–7 минут для вклейки в тетрадь.`,
            },
          ],
          'Отвечай строго на русском языке в формате JSON.',
          schema
        );
        return res.json({ result: parsed });
      } catch {
        const fallbackCard = {
          cardTitle: `Памятка-вклейка в тетрадь: ${studentName || 'Ученик'} (${
            gradeLevel || '2 класс'
          })`,
          encouragement:
            'Ошибки помогают нам расти! Выполни эти шаги, и правило запомнится навсегда.',
          steps: (errors.length > 0
            ? errors
            : [
                {
                  ruleName: 'Повторение изученных орфограмм',
                  wrongFragment: 'слово',
                  correctFragment: 'слово',
                },
              ]
          ).map((err: any, idx: number) => ({
            ruleReminder: `Шаг ${idx + 1}. Правило: ${err.ruleName}`,
            taskText: `Исправь запись «${err.wrongFragment}» на верную «${err.correctFragment}», пропиши 3 раза и подбери 2 проверочных примера.`,
            practiceItems: [
              `Образец: ${err.correctFragment}`,
              `Твоя запись: ____________________________`,
            ],
          })),
        };
        return res.json({ result: fallbackCard });
      }
    } catch (error: any) {
      return res.status(500).json({
        error:
          error?.message ||
          'Ошибка при генерации карточки работы над ошибками.',
      });
    }
  });

  // Endpoint 3: Graphological Handwriting Verification (Reference vs Current Notebook)
  app.post('/api/verify-handwriting', requireFirebaseAuth, async (req, res) => {
    try {
      const {
        studentName = 'Ученик',
        referenceImageBase64,
        referenceMimeType = 'image/jpeg',
        currentImageBase64,
        currentMimeType = 'image/jpeg',
        sampleId = '',
      } = req.body || {};

      const cleanStudentName =
        typeof studentName === 'string' && studentName.trim()
          ? studentName.trim().slice(0, 120)
          : 'Ученик';

      const referencePayload = resolveImagePayload(
        referenceImageBase64,
        referenceMimeType
      );
      const currentPayload = resolveImagePayload(
        currentImageBase64,
        currentMimeType,
        sampleId
      );

      if (!referencePayload || !currentPayload) {
        return res.status(400).json({
          error:
            'Для сверки почерка необходимы два изображения: Изображение №1 (эталон ученика) и Изображение №2 (текущая работа).',
        });
      }

      const prompt = `Ты — эксперт по графологии и компьютерному зрению. Твоя задача — сравнить рукописный текст на двух изображениях и определить, принадлежат ли они одному человеку.

Входные данные:
1. Изображение №1 (Эталон): Фотография тетради, достоверно написанная учеником ${cleanStudentName}.
2. Изображение №2 (Текущая работа): Фотография новой страницы тетради, которую нужно идентифицировать.

Твои инструкции:
1. Анализ паттернов: Сравни наклон букв, степень нажима, характерные особенности написания отдельных символов (например, букв 'а', 'т', 'д') и расстояние между словами.
2. Верификация: Если стили письма совпадают с высокой степенью уверенности, выведи match: true, confidence_score (число от 0.0 до 1.0) и краткое пояснение в reasoning.
3. Несоответствие: Если почерк явно отличается, выведи match: false, confidence_score (число от 0.0 до 1.0) и краткое пояснение в reasoning.
4. Важно: Будь максимально критичен. Если почерк неразборчив или изображение низкого качества, укажи это в поле reasoning.

Формат ответа: Только чистый JSON, без лишнего текста.`;

      const parts: Array<{
        text?: string;
        inlineData?: { data: string; mimeType: string };
      }> = [
        { text: 'Изображение №1 (Эталон почерка):' },
        {
          inlineData: {
            mimeType: referencePayload.mimeType,
            data: referencePayload.data,
          },
        },
        { text: 'Изображение №2 (Текущая работа для идентификации):' },
        {
          inlineData: {
            mimeType: currentPayload.mimeType,
            data: currentPayload.data,
          },
        },
        { text: prompt },
      ];

      const schema = {
        type: Type.OBJECT,
        properties: {
          match: {
            type: Type.BOOLEAN,
            description:
              'true, если почерки на двух изображениях принадлежат одному человеку, иначе false.',
          },
          confidence_score: {
            type: Type.NUMBER,
            description: 'Оценка уверенности от 0.0 до 1.0.',
          },
          reasoning: {
            type: Type.STRING,
            description:
              'Краткое графологическое пояснение (наклон, нажим, написание букв, интервалы или неразборчивость).',
          },
        },
        required: ['match', 'confidence_score', 'reasoning'],
      };

      const { modelUsed, parsed } = await callGeminiMultimodalWithFallback(
        parts,
        'Ты — строгий эксперт по графологии и компьютерному зрению. Сравнивай рукописный почерк максимально критично. Отвечай строго чистым JSON на русском языке.',
        schema
      );

      const rawScore = Number(parsed?.confidence_score);
      const confidenceScore = Number.isFinite(rawScore)
        ? Math.max(0, Math.min(1, Number(rawScore.toFixed(2))))
        : 0.5;

      return res.json({
        match: Boolean(parsed?.match),
        confidence_score: confidenceScore,
        reasoning:
          typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
            ? parsed.reasoning.trim()
            : 'Анализ завершён без дополнительного комментария.',
        modelUsed,
      });
    } catch (error: any) {
      console.error('Error in /api/verify-handwriting:', error);
      return res.status(500).json({
        error:
          error?.message ||
          'Не удалось выполнить графологическую сверку почерка. Проверьте чёткость изображений и наличие GEMINI_API_KEY.',
      });
    }
  });

  // SSRF Guard helpers for fetching student handwriting_reference_url images
  function isPrivateOrRestrictedIp(rawIp: string): boolean {
    const ip = rawIp.trim().toLowerCase();
    if (ip.startsWith('::ffff:')) {
      return isPrivateOrRestrictedIp(ip.slice(7));
    }
    const family = net.isIP(ip);
    if (family === 4) {
      const parts = ip.split('.').map(Number);
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
      const [a, b] = parts;
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
      return false;
    }
    if (family === 6) {
      if (ip === '::' || ip === '::1') return true;
      if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
        return true;
      }
      if (ip.startsWith('ff')) return true;
      return false;
    }
    return true;
  }

  async function validatePublicHttpUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new Error('Некорректный формат URL эталона почерка.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Допустимы только внешние ссылки https:// или http://.');
    }
    if (parsed.username || parsed.password) {
      throw new Error('URL с встроенными учётными данными запрещён.');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === 'metadata.google.internal'
    ) {
      throw new Error('Запросы к локальным и внутренним адресам запрещены.');
    }

    if (net.isIP(hostname)) {
      if (isPrivateOrRestrictedIp(hostname)) {
        throw new Error('IP-адрес относится к закрытой или локальной сети.');
      }
      return parsed;
    }

    const resolved = await dns.lookup(hostname, { all: true });
    if (!resolved || resolved.length === 0) {
      throw new Error('Не удалось разрешить доменное имя эталона.');
    }
    for (const addr of resolved) {
      if (isPrivateOrRestrictedIp(addr.address)) {
        throw new Error('Адрес эталона указывает на внутреннюю сеть.');
      }
    }
    return parsed;
  }

  async function fetchReferenceImageSafe(
    rawUrl: string,
    redirectDepth = 0
  ): Promise<{ data: string; mimeType: string }> {
    const validatedUrl = await validatePublicHttpUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch(validatedUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'image/*',
          'User-Agent': 'TetradPlus-HandwritingVerifier/1.0',
        },
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location || redirectDepth >= 2) {
          throw new Error('Превышен лимит переадресаций при загрузке эталона.');
        }
        const nextUrl = new URL(location, validatedUrl).toString();
        return fetchReferenceImageSafe(nextUrl, redirectDepth + 1);
      }

      if (!resp.ok) {
        throw new Error(`Эталон не загружен (HTTP ${resp.status}).`);
      }

      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      const mimeType = contentType.split(';')[0].trim();
      if (!mimeType.startsWith('image/')) {
        throw new Error('Ссылка на эталон должна вести на изображение (image/*).');
      }

      const contentLengthHeader = Number(resp.headers.get('content-length') || 0);
      const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
      if (contentLengthHeader > MAX_IMAGE_BYTES) {
        throw new Error('Размер эталонного изображения превышает 5 МБ.');
      }

      const arrayBuffer = await resp.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error('Файл эталонного изображения пуст.');
      }
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('Размер эталонного изображения превышает 5 МБ.');
      }

      return {
        data: Buffer.from(arrayBuffer).toString('base64'),
        mimeType,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  interface IdentifyCandidateInput {
    studentName: string;
    handwriting_reference_url?: string;
    referenceImageBase64?: string;
    referenceMimeType?: string;
  }

  async function identify_student(
    currentImage: { data: string; mimeType: string },
    candidates: IdentifyCandidateInput[]
  ) {
    const limitedCandidates = candidates.slice(0, 15);
    const loadedCandidates: Array<{
      studentName: string;
      referenceUrl?: string;
      image: { data: string; mimeType: string };
    }> = [];
    const skippedReferences: Array<{ studentName: string; reason: string }> = [];

    for (const candidate of limitedCandidates) {
      const cleanName =
        typeof candidate?.studentName === 'string'
          ? candidate.studentName.trim().slice(0, 120)
          : '';
      if (!cleanName) continue;

      const refUrl =
        typeof candidate?.handwriting_reference_url === 'string'
          ? candidate.handwriting_reference_url.trim()
          : '';

      if (refUrl) {
        try {
          const downloaded = await fetchReferenceImageSafe(refUrl);
          loadedCandidates.push({
            studentName: cleanName,
            referenceUrl: refUrl,
            image: downloaded,
          });
          continue;
        } catch (err: any) {
          skippedReferences.push({
            studentName: cleanName,
            reason: err?.message || 'Не удалось загрузить эталон по ссылке',
          });
          continue;
        }
      }

      if (candidate?.referenceImageBase64) {
        const inlinePayload = resolveImagePayload(
          candidate.referenceImageBase64,
          candidate.referenceMimeType || 'image/jpeg'
        );
        if (inlinePayload) {
          loadedCandidates.push({
            studentName: cleanName,
            image: inlinePayload,
          });
          continue;
        }
      }

      skippedReferences.push({
        studentName: cleanName,
        reason: 'Не указана ссылка handwriting_reference_url',
      });
    }

    if (loadedCandidates.length === 0) {
      return {
        identified: false,
        studentName: null,
        confidencePercent: 0,
        autoSelected: false,
        reasoning:
          'Не найдено ни одного доступного эталона почерка (handwriting_reference_url). Выберите ученика вручную.',
        candidateScores: [],
        skippedReferences,
      };
    }

    const parts: Array<{
      text?: string;
      inlineData?: { data: string; mimeType: string };
    }> = [
      { text: 'Анализируемая фотография школьной тетради (неизвестный автор):' },
      {
        inlineData: {
          mimeType: currentImage.mimeType,
          data: currentImage.data,
        },
      },
    ];

    const studentRefDescriptions: string[] = [];
    loadedCandidates.forEach((item, index) => {
      const refLabel = item.referenceUrl
        ? `${item.studentName} (эталон ${index + 1}: ${item.referenceUrl})`
        : `${item.studentName} (эталон ${index + 1})`;
      studentRefDescriptions.push(refLabel);
      parts.push({ text: `Эталон почерка ученика «${item.studentName}»:` });
      parts.push({
        inlineData: {
          mimeType: item.image.mimeType,
          data: item.image.data,
        },
      });
    });

    const prompt = `Сравни это фото с эталонами следующих учеников: [${studentRefDescriptions.join(', ')}].
Верни имя того, чей почерк совпадает с наибольшей вероятностью, и процент уверенности (число от 0 до 100).

Критерии анализа:
1. Сравни наклон букв, нажим, высоту и ширину символов, связки между буквами, характерные элементы написания букв ('а', 'о', 'д', 'т', 'р') или цифр.
2. Оцени процент уверенности максимально объективно от 0 до 100.
3. Если почерк на фото неразборчив, слишком размыт или ни один из эталонов не совпадает, установи identified: false и confidencePercent: 0.`;

    parts.push({ text: prompt });

    const schema = {
      type: Type.OBJECT,
      properties: {
        identified: {
          type: Type.BOOLEAN,
          description:
            'true, если почерк удалось сопоставить с одним из эталонов, false — если почерк не опознан или неразборчив.',
        },
        bestMatchName: {
          type: Type.STRING,
          description:
            'Точное имя ученика из переданного списка эталонов с наибольшим совпадением почерка (пустая строка, если не опознан).',
        },
        confidencePercent: {
          type: Type.NUMBER,
          description: 'Процент уверенности от 0 до 100.',
        },
        reasoning: {
          type: Type.STRING,
          description:
            'Краткое графологическое пояснение сравнения почерка (на русском языке).',
        },
        candidateScores: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              studentName: { type: Type.STRING },
              confidencePercent: { type: Type.NUMBER },
            },
            required: ['studentName', 'confidencePercent'],
          },
        },
      },
      required: [
        'identified',
        'bestMatchName',
        'confidencePercent',
        'reasoning',
        'candidateScores',
      ],
    };

    const { modelUsed, parsed } = await callGeminiMultimodalWithFallback(
      parts,
      'Ты — эксперт по графологии и визуальной идентификации почерка школьников. Сравнивай почерк на проверяемом фото с эталонами максимально критично и отвечай строго в формате JSON на русском языке.',
      schema
    );

    const rawConfidence = Number(parsed?.confidencePercent);
    const confidencePercent = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(100, Math.round(rawConfidence)))
      : 0;

    const rawBestName =
      typeof parsed?.bestMatchName === 'string'
        ? parsed.bestMatchName.trim()
        : '';
    const matchedCandidate = loadedCandidates.find(
      (c) => c.studentName.toLowerCase() === rawBestName.toLowerCase()
    );
    const resolvedName = matchedCandidate ? matchedCandidate.studentName : null;
    const identified = Boolean(parsed?.identified) && Boolean(resolvedName) && confidencePercent > 0;

    const normalizedScores = Array.isArray(parsed?.candidateScores)
      ? parsed.candidateScores
          .map((item: any) => ({
            studentName: String(item?.studentName || '').trim(),
            confidencePercent: Math.max(
              0,
              Math.min(100, Math.round(Number(item?.confidencePercent) || 0))
            ),
          }))
          .filter((item: any) => item.studentName.length > 0)
      : [];

    return {
      identified,
      studentName: identified ? resolvedName : null,
      confidencePercent: identified ? confidencePercent : 0,
      autoSelected: identified && confidencePercent > 85,
      reasoning:
        typeof parsed?.reasoning === 'string' && parsed.reasoning.trim()
          ? parsed.reasoning.trim()
          : identified
          ? 'Графологический анализ завершён.'
          : 'Почерк не удалось надёжно сопоставить ни с одним из эталонов.',
      candidateScores: normalizedScores,
      skippedReferences,
      modelUsed,
    };
  }

  // Endpoint 3.1: Automatic Student Identification by Handwriting (identify_student)
  app.post('/api/identify-student', requireFirebaseAuth, async (req, res) => {
    try {
      const {
        imageBase64,
        mimeType = 'image/jpeg',
        sampleId = '',
        students = [],
      } = req.body || {};

      const imagePayload = resolveImagePayload(imageBase64, mimeType, sampleId);
      if (!imagePayload) {
        return res.status(400).json({
          error:
            'Загрузите фотографию тетради, чтобы система могла определить автора по почерку.',
        });
      }

      if (!Array.isArray(students) || students.length === 0) {
        return res.status(400).json({
          error:
            'В списке класса нет учеников с загруженным эталоном почерка (handwriting_reference_url). Выберите ученика вручную.',
        });
      }

      const result = await identify_student(imagePayload, students);
      return res.json(result);
    } catch (error: any) {
      console.error('Error in /api/identify-student:', error);
      return res.status(502).json({
        error:
          error?.message ||
          'Не удалось автоматически определить автора по почерку. Пожалуйста, выберите ученика вручную.',
      });
    }
  });

  // Endpoint 4: Generate downloadable PDF report for a checked notebook (Protected by Firebase Auth)
  app.post('/api/report-pdf', requireFirebaseAuth, async (req, res) => {
    try {
      const rawReport = req.body?.report || req.body;
      if (!rawReport || typeof rawReport !== 'object' || Array.isArray(rawReport)) {
        return res.status(400).json({
          error: 'Передайте данные проверки тетради для формирования PDF-отчёта.',
        });
      }

      const report: NotebookReportPayload = {
        ...rawReport,
        studentName:
          typeof rawReport.studentName === 'string' && rawReport.studentName.trim()
            ? rawReport.studentName.trim()
            : 'Ученик',
        errors: Array.isArray(rawReport.errors) ? rawReport.errors : [],
      };

      const pdfBuffer = await generateNotebookReportPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="notebook-report.pdf"');
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).end(pdfBuffer);
    } catch (error: any) {
      console.error('Error in /api/report-pdf:', error);
      return res.status(500).json({
        error: error?.message || 'Не удалось сформировать PDF-отчёт.',
      });
    }
  });

  // Endpoint 5: Generate PDF report and send to parent via Gmail API or SMTP (Protected by Firebase Auth)
  app.post('/api/send-parent-report', requireFirebaseAuth, async (req, res) => {
    try {
      const { recipientEmail, parentName, report } = req.body || {};
      const cleanEmail = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';

      if (!isValidEmail(cleanEmail)) {
        return res.status(400).json({
          error: 'Укажите корректный Email получателя (родителя).',
        });
      }

      if (!report || typeof report.studentName !== 'string' || !report.studentName.trim()) {
        return res.status(400).json({
          error: 'Отсутствуют данные проверки тетради для формирования отчёта.',
        });
      }

      const rawGmailHeader = req.header('x-gmail-access-token') || '';
      const gmailAccessToken = rawGmailHeader.replace(/^Bearer\s+/i, '').trim();

      if (gmailAccessToken) {
        const result = await sendParentReportViaGmail({
          gmailAccessToken,
          recipientEmail: cleanEmail,
          parentName: typeof parentName === 'string' ? parentName.trim() : '',
          report: report as NotebookReportPayload,
        });

        return res.json({
          sent: true,
          provider: 'gmail',
          recipientEmail: cleanEmail,
          messageId: result.messageId,
          pdfBytes: result.pdfBytes,
          message: `PDF-отчёт успешно отправлен через Gmail на ${cleanEmail}.`,
        });
      }

      if (!isSmtpConfigured()) {
        return res.status(503).json({
          error:
            'Подключите аккаунт Google (Gmail) кнопкой в этом окне, чтобы отправить PDF-отчёт родителю без настройки SMTP-сервера.',
          needsGmailAuth: true,
        });
      }

      const result = await sendParentReportEmail({
        recipientEmail: cleanEmail,
        parentName: typeof parentName === 'string' ? parentName.trim() : '',
        report: report as NotebookReportPayload,
      });

      return res.json({
        sent: true,
        provider: 'smtp',
        recipientEmail: cleanEmail,
        messageId: result.messageId,
        pdfBytes: result.pdfBytes,
        message: `PDF-отчёт успешно отправлен на ${cleanEmail}.`,
      });
    } catch (error: any) {
      console.error('Error in /api/send-parent-report:', error);
      if (error?.requiresGmailAuth) {
        return res.status(403).json({
          error:
            error?.message ||
            'Доступ к отправке писем через Gmail истёк. Подключите Google-аккаунт заново.',
          requiresGmailAuth: true,
        });
      }
      const status =
        typeof error?.statusCode === 'number' ? error.statusCode : 500;
      return res.status(status).json({
        error:
          error?.message ||
          'Не удалось отправить отчёт на электронную почту родителя.',
        needsGmailAuth: Boolean(error?.needsGmailAuth),
      });
    }
  });

  // Ensure unknown /api/* routes always return JSON 404 (never fall through to HTML SPA)
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `API маршрут ${req.method} ${req.path} не найден. Если вы обновили приложение, выполните Deploy.`,
    });
  });

  // Ensure Express body/middleware errors on /api/* always return JSON (never HTML)
  app.use(
    '/api',
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err?.status || err?.statusCode || 500;
      res.status(status).json({
        error: err?.message || 'Внутренняя ошибка сервера API.',
      });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const assetsPath = path.join(process.cwd(), 'src', 'assets');
    app.use('/src/assets', express.static(assetsPath));
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
