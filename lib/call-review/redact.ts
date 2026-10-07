// Masks personal identifiers before anything is stored or sent to an AI model. Conservative: when unsure, mask.

const DIGIT_WORDS = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
// "six one five five five five one two three four" (spoken numbers), 7 or more digit words in a row.
const SPOKEN_DIGITS = new RegExp(`\\b(?:(?:${DIGIT_WORDS}|\\d)[\\s,.-]+){6,}(?:${DIGIT_WORDS}|\\d)\\b`, "gi");
// "john dot smith at gmail dot com"
const SPOKEN_EMAIL = /\b[\w.-]+(?:\s+dot\s+[\w-]+)*\s+at\s+[\w-]+(?:\s+dot\s+(?:com|net|org|edu|gov|co|io|us))\b/gi;

export function redact(text: string): string {
  if (!text) return "";
  return text
    .replace(/https?:\/\/\S+/gi, "[LINK]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(SPOKEN_EMAIL, "[EMAIL]")
    .replace(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, "[PHONE]")
    .replace(/(?<!\d)\d(?:[\s-]?\d){11,18}(?!\d)/g, "[NUMBER]")
    .replace(/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, "[NUMBER]")
    .replace(SPOKEN_DIGITS, "[NUMBER]");
}
