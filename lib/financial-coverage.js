// Shared numeric safety: every monetary value in the user's message must survive interpretation.
export function monetaryEvidence(text) {
  const cleaned = String(text).toLowerCase()
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
    .replace(/\b\d+\s*(?:x\b|vezes\b|parcelas?\b|dias?\b|horas?\b)/g, " ")
    .replace(/\b(?:dia|às|as)\s+\d+(?::\d+)?/g, " ");
  return [...cleaned.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?/g)]
    .map(([value]) => Math.round(Number(value.replace(/\./g, "").replace(",", ".")) * 100));
}

export function needsFinancialIntelligence(text) {
  const normalized = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const amounts = monetaryEvidence(text);
  if (/\b(corrig|corrige|corrigir|correcao|na verdade|nao foi|o segundo|o primeiro|aquele|anterior)\b/.test(normalized)) return true;
  if (!amounts.length) return false;
  if (amounts.length > 1 || /\b(parcel|parcelei|dividi|vezes)\w*|\d\s*x\b/.test(normalized)) return true;
  if ((normalized.match(/\b(ontem|hoje|amanha|anteontem)\b/g) || []).length > 1) return true;
  return !/^(?:ontem |hoje |anteontem )?(?:gastei|paguei|recebi|abasteci)\b/.test(normalized) || /\s+e\s+/.test(normalized);
}

export function hasCompleteMonetaryCoverage(text, transactions) {
  const expected = monetaryEvidence(text).sort((a, b) => a - b);
  if (!expected.length || !Array.isArray(transactions) || transactions.length !== expected.length) return false;
  const actual = transactions
    .map((item) => typeof item?.amount === "number" ? Math.round(item.amount * 100) : NaN)
    .sort((a, b) => a - b);
  return actual.every((amount, i) => Number.isSafeInteger(amount) && amount > 0 && amount === expected[i]);
}
