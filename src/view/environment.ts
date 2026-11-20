// What every part of a view needs from the view that holds it: its words, its language, and the clipboard.
export interface ViewEnvironment {
  t(token: string, values?: Record<string, string | number>): string;
  language: string;
  copy(text: string): Promise<boolean>;
}
