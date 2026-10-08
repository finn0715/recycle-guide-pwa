export type CallLanguage = "ko" | "en";
export function isCallLanguage(value: string): value is CallLanguage {
  return value === "ko" || value === "en";
}
export function callGreeting(language: CallLanguage) {
  return language === "en"
    ? "Greet the user in one short English sentence: What would you like to throw away?"
    : "통화의 첫인사로 한국어 존댓말 한 문장만 말하세요: 무엇을 버리려고 하세요?";
}
