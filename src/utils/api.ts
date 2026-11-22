export async function safeParseJsonResponse<T = any>(
  response: Response
): Promise<T> {
  const rawText = await response.text();
  const trimmed = rawText.trim();

  if (!trimmed) {
    return {} as T;
  }

  if (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<')
  ) {
    throw new Error(
      `Сервер вернул HTML вместо JSON (HTTP ${response.status}). Если вы используете опубликованное приложение, нажмите «Deploy» (Опубликовать) в правом верхнем углу AI Studio, чтобы обновить серверные маршруты.`
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `Некорректный ответ сервера (HTTP ${response.status}): ожидался JSON.`
    );
  }
}
