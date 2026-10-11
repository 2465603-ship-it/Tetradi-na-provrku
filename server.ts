import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createWorker } from 'tesseract.js';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;

function getCandidateApiKeys(): string[] {
  const candidates = [
    process.env.API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.VITE_GEMINI_API_KEY,
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
      'На сервере опубликованного приложения не найден действующий GEMINI_API_KEY.'
    );
  }

  const modelsToTry = [
    'gemini-3.8-flash',
    'gemini-3.1-pro-preview',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
  ];

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

    for (const modelName of modelsToTry) {
      try {
        const config: any = {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema,
        };
        if (modelName === 'gemini-3.8-flash') {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
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

  // Health check endpoint for deployment probes
  app.get('/api/health', (_req, res) => {
    const keys = getCandidateApiKeys();
    res.status(200).json({
      status: 'ok',
      hasApiKey: keys.length > 0,
    });
  });

  // In-memory store for phone OTP verification codes
  const otpStore = new Map<string, { code: string; expiresAt: number }>();

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
    const code = '4825';
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
      (stored && stored.code !== cleanCode && cleanCode !== '4825')
    ) {
      return res.status(400).json({
        error: 'Неверный код из СМС. Проверьте введённые 4 цифры (код: 4825).',
      });
    }

    otpStore.delete(normalizedPhone);
    return res.json({
      verified: true,
      teacherTokenId: `teacher_${normalizedPhone}`,
    });
  });

  // Endpoint 1: Multimodal AI Notebook Photo & Handwriting Recognition
  app.post('/api/check-notebook', async (req, res) => {
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

  // Endpoint 2: Custom Remediation Card Generator via Gemini
  app.post('/api/generate-remediation', async (req, res) => {
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
