import { v7 as uuidv7 } from 'uuid';

/** Zaman sıralı (index dostu) kimlik üretimi — tüm tablolar bunu kullanır */
export function newId(): string {
  return uuidv7();
}
