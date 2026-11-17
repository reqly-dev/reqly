import type { VariableResolver } from '../core/variables/resolve.js';

const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

export interface InterpolationContext {
  resolver: VariableResolver;
  /** Çözülemeyen değişken adları burada toplanır */
  unresolved: Set<string>;
  /** İnterpolasyonda kullanılan tüm anahtarlar (secret maskeleme için) */
  usedKeys: Set<string>;
}

export function createContext(resolver: VariableResolver): InterpolationContext {
  return { resolver, unresolved: new Set(), usedKeys: new Set() };
}

/** {{degisken}} ifadelerini çözer; çözülemeyenler olduğu gibi bırakılır ve raporlanır */
export function interpolate(input: string, ctx: InterpolationContext): string {
  return input.replace(VAR_PATTERN, (match, key: string) => {
    ctx.usedKeys.add(key);
    const found = ctx.resolver(key);
    if (found === undefined) {
      ctx.unresolved.add(key);
      return match;
    }
    return found.value;
  });
}

/** Secret değerleri metin içinde maskeler (history/log yazımından önce) */
export function maskSecrets(input: string, secretValues: string[], mask: string): string {
  let out = input;
  for (const secret of secretValues) {
    if (secret) out = out.split(secret).join(mask);
  }
  return out;
}
