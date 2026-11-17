export type CodeLanguage = 'json' | 'xml' | 'javascript' | 'text';

export function formatJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

/**
 * Bağımlılıksız, DOM parser kullanmayan XML/HTML güzelleştirici: etiket derinliğine
 * göre girinti verir. Tam bir XML parser değildir (örn. tırnak içindeki '>' karakterini
 * ayırt etmez) — "hafif" ilkesiyle uyumlu, tipik API yanıtları için yeterlidir.
 */
export function formatXml(text: string): string {
  const INDENT = '  ';
  const collapsed = text.replace(/>\s*</g, '><').trim();
  if (!collapsed) return text;

  const tokens = collapsed.split(/(<[^>]+>)/).filter((t) => t.trim() !== '');
  const lines: string[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (/^<[?!]/.test(token)) {
      lines.push(INDENT.repeat(depth) + token);
    } else if (/^<\/[^>]+>$/.test(token)) {
      depth = Math.max(0, depth - 1);
      lines.push(INDENT.repeat(depth) + token);
    } else if (/^<[^>]+\/>$/.test(token)) {
      lines.push(INDENT.repeat(depth) + token);
    } else if (/^<[^>]+>$/.test(token)) {
      lines.push(INDENT.repeat(depth) + token);
      depth += 1;
    } else {
      lines.push(INDENT.repeat(depth) + token.trim());
    }
  }
  return lines.join('\n');
}

/** Content-Type başlığından düzenleyici dilini seç */
export function languageFromContentType(contentType: string | undefined | null): CodeLanguage {
  if (!contentType) return 'text';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('xml') || contentType.includes('html')) return 'xml';
  return 'text';
}

/** İçerik gövdesinden dil tahmini (content-type bilinmediğinde, örn. yanıt gövdesi için) */
export function sniffLanguage(body: string): CodeLanguage {
  const trimmed = body.trim();
  if (!trimmed) return 'text';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // JSON değilmiş, devam
    }
  }
  if (trimmed.startsWith('<')) return 'xml';
  return 'text';
}

export function formatByLanguage(text: string, language: CodeLanguage): string {
  if (language === 'json') return formatJson(text);
  if (language === 'xml') return formatXml(text);
  return text;
}
