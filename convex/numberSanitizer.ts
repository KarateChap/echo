/**
 * Ensures all numbers in TTS readback text are Arabic numerals (0-9)
 * so they are spoken in English regardless of the surrounding language.
 */

// Full-width digits (used in Japanese/Chinese/Korean contexts): ０-９
const FULLWIDTH_MAP: Record<string, string> = {
  "\uFF10": "0", "\uFF11": "1", "\uFF12": "2", "\uFF13": "3", "\uFF14": "4",
  "\uFF15": "5", "\uFF16": "6", "\uFF17": "7", "\uFF18": "8", "\uFF19": "9",
};

// CJK number words → digit values
const CJK_UNITS: [RegExp, number][] = [
  [/兆/g, 1_000_000_000_000],
  [/億/g, 100_000_000],
  [/万|萬/g, 10_000],
  [/千|仟/g, 1_000],
  [/百|佰/g, 100],
  [/十|拾/g, 10],
];

const CJK_DIGITS: Record<string, number> = {
  "零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
};

function replaceCJKNumber(match: string): string {
  let result = 0;
  let current = 0;

  for (const char of match) {
    if (char in CJK_DIGITS) {
      current = CJK_DIGITS[char];
    } else {
      for (const [pattern, value] of CJK_UNITS) {
        if (pattern.test(char)) {
          result += (current || 1) * value;
          current = 0;
          break;
        }
      }
    }
  }
  result += current;
  return result > 0 ? result.toLocaleString() : match;
}

// ── Word-based number replacements (Tagalog, English, Spanish, etc.) ──

// Tagalog cardinal numbers and their prefixed/suffixed forms
// Ordered longest-first so "dalawampu" matches before "dalawa"
const TAGALOG_NUMBERS: [RegExp, string][] = [
  // Compound tens (20-90)
  [/\btatlumpu('t\s+|\s+at\s+)?/gi, "30"],
  [/\bapat(na)?pu('t\s+|\s+at\s+)?/gi, "40"],
  [/\blimampu('t\s+|\s+at\s+)?/gi, "50"],
  [/\banim(na)?pu('t\s+|\s+at\s+)?/gi, "60"],
  [/\bpitumpu('t\s+|\s+at\s+)?/gi, "70"],
  [/\bwalumpu('t\s+|\s+at\s+)?/gi, "80"],
  [/\bsiyam(na)?pu('t\s+|\s+at\s+)?/gi, "90"],
  [/\bdalawampu('t\s+|\s+at\s+)?/gi, "20"],

  // Tagalog "na" prefix forms (e.g., "dalawang beses" → "2 beses")
  [/\bisang\b/gi, "1"],
  [/\bdalawang\b/gi, "2"],
  [/\btatlong\b/gi, "3"],
  [/\bapat\s*na\b/gi, "4"],
  [/\blimang\b/gi, "5"],
  [/\banim\s*na\b/gi, "6"],
  [/\bpitong\b/gi, "7"],
  [/\bwalong\b/gi, "8"],
  [/\bsiyam\s*na\b/gi, "9"],
  [/\bsampung\b/gi, "10"],

  // Tagalog multiplier forms ("daan" = hundred, "libo" = thousand)
  [/\bsandaan\b/gi, "100"],
  [/\bdalawang\s*daan\b/gi, "200"],
  [/\btatlong\s*daan\b/gi, "300"],
  [/\bapat\s*na\s*raan\b/gi, "400"],
  [/\blimang\s*daan\b/gi, "500"],
  [/\banim\s*na\s*raan\b/gi, "600"],
  [/\bpitong\s*daan\b/gi, "700"],
  [/\bwalong\s*daan\b/gi, "800"],
  [/\bsiyam\s*na\s*raan\b/gi, "900"],
  [/\bsanlibo\b/gi, "1,000"],
  [/\bdalawang\s*libo\b/gi, "2,000"],
  [/\btatlong\s*libo\b/gi, "3,000"],
  [/\bapat\s*na\s*libo\b/gi, "4,000"],
  [/\blimang\s*libo\b/gi, "5,000"],
  [/\banim\s*na\s*libo\b/gi, "6,000"],
  [/\bpitong\s*libo\b/gi, "7,000"],
  [/\bwalong\s*libo\b/gi, "8,000"],
  [/\bsiyam\s*na\s*libo\b/gi, "9,000"],
  [/\bsampung\s*libo\b/gi, "10,000"],

  // Standalone Tagalog cardinals (must come after prefixed forms)
  [/\bisa\b/gi, "1"],
  [/\bdalawa\b/gi, "2"],
  [/\btatlo\b/gi, "3"],
  [/\bapat\b/gi, "4"],
  [/\blima\b/gi, "5"],
  [/\banim\b/gi, "6"],
  [/\bpito\b/gi, "7"],
  [/\bwalo\b/gi, "8"],
  [/\bsiyam\b/gi, "9"],
  [/\bsampu\b/gi, "10"],
  [/\blibo\b/gi, "1,000"],
  [/\bdaan\b/gi, "100"],
  [/\braan\b/gi, "100"],
];

// English number words
const ENGLISH_NUMBERS: [RegExp, string][] = [
  [/\btwenty\b/gi, "20"],
  [/\bthirty\b/gi, "30"],
  [/\bforty\b/gi, "40"],
  [/\bfifty\b/gi, "50"],
  [/\bsixty\b/gi, "60"],
  [/\bseventy\b/gi, "70"],
  [/\beighty\b/gi, "80"],
  [/\bninety\b/gi, "90"],
  [/\bhundred\b/gi, "100"],
  [/\bthousand\b/gi, "1,000"],
  [/\bmillion\b/gi, "1,000,000"],
  [/\bone\b/gi, "1"],
  [/\btwo\b/gi, "2"],
  [/\bthree\b/gi, "3"],
  [/\bfour\b/gi, "4"],
  [/\bfive\b/gi, "5"],
  [/\bsix\b/gi, "6"],
  [/\bseven\b/gi, "7"],
  [/\beight\b/gi, "8"],
  [/\bnine\b/gi, "9"],
  [/\bten\b/gi, "10"],
  [/\beleven\b/gi, "11"],
  [/\btwelve\b/gi, "12"],
  [/\bthirteen\b/gi, "13"],
  [/\bfourteen\b/gi, "14"],
  [/\bfifteen\b/gi, "15"],
  [/\bsixteen\b/gi, "16"],
  [/\bseventeen\b/gi, "17"],
  [/\beighteen\b/gi, "18"],
  [/\bnineteen\b/gi, "19"],
];

// Spanish number words (common in Filipino context)
const SPANISH_NUMBERS: [RegExp, string][] = [
  [/\buno\b/gi, "1"],
  [/\bdos\b/gi, "2"],
  [/\btres\b/gi, "3"],
  [/\bcuatro\b/gi, "4"],
  [/\bcinco\b/gi, "5"],
  [/\bseis\b/gi, "6"],
  [/\bsiete\b/gi, "7"],
  [/\bocho\b/gi, "8"],
  [/\bnueve\b/gi, "9"],
  [/\bdiez\b/gi, "10"],
  [/\bveinte\b/gi, "20"],
  [/\bcien\b/gi, "100"],
  [/\bmil\b/gi, "1,000"],
];

// Korean number words (native Korean)
const KOREAN_NUMBERS: [RegExp, string][] = [
  [/하나/g, "1"],
  [/둘/g, "2"],
  [/셋/g, "3"],
  [/넷/g, "4"],
  [/다섯/g, "5"],
  [/여섯/g, "6"],
  [/일곱/g, "7"],
  [/여덟/g, "8"],
  [/아홉/g, "9"],
  [/열/g, "10"],
];

// Japanese counter-adjacent number words
const JAPANESE_NUMBERS: [RegExp, string][] = [
  [/一つ/g, "1"],
  [/二つ/g, "2"],
  [/三つ/g, "3"],
  [/四つ/g, "4"],
  [/五つ/g, "5"],
  [/六つ/g, "6"],
  [/七つ/g, "7"],
  [/八つ/g, "8"],
  [/九つ/g, "9"],
];

/**
 * Sanitize readback text so all numbers are Arabic numerals for TTS.
 */
export function sanitizeNumbersForTts(text: string): string {
  let result = text;

  // 1. Replace full-width digits → ASCII digits
  result = result.replace(/[\uFF10-\uFF19]/g, (ch) => FULLWIDTH_MAP[ch] ?? ch);

  // 2. Replace CJK number sequences (e.g., 五千, 一万, 三百)
  const cjkPattern = /[零〇一二三四五六七八九十百千万億兆萬佰仟拾]+/g;
  result = result.replace(cjkPattern, (match) => {
    if (/[十百千万億兆萬佰仟拾]/.test(match)) {
      return replaceCJKNumber(match);
    }
    if (match.length === 1 && match in CJK_DIGITS) {
      return String(CJK_DIGITS[match]);
    }
    return match;
  });

  // 3. Replace Korean number words attached to digits (e.g., 1만 → 10000)
  result = result.replace(/(\d+)만/g, (_, n) => String(parseInt(n) * 10000).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  result = result.replace(/(\d+)천/g, (_, n) => String(parseInt(n) * 1000).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  result = result.replace(/(\d+)백/g, (_, n) => String(parseInt(n) * 100));

  // 4. Replace Japanese counter words
  for (const [pattern, replacement] of JAPANESE_NUMBERS) {
    result = result.replace(pattern, replacement);
  }

  // 5. Replace Korean native number words
  for (const [pattern, replacement] of KOREAN_NUMBERS) {
    result = result.replace(pattern, replacement);
  }

  // 6. Replace Tagalog number words (longest compound forms first)
  for (const [pattern, replacement] of TAGALOG_NUMBERS) {
    result = result.replace(pattern, replacement);
  }

  // 7. Replace English number words
  for (const [pattern, replacement] of ENGLISH_NUMBERS) {
    result = result.replace(pattern, replacement);
  }

  // 8. Replace Spanish number words
  for (const [pattern, replacement] of SPANISH_NUMBERS) {
    result = result.replace(pattern, replacement);
  }

  // 9. Tagalog ordinal prefix "ika-" followed by a word number → digit
  // e.g., "ika-dalawa" is already handled since "dalawa" → "2"

  return result;
}
