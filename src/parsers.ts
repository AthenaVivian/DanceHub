import type { GmailSourceEmail, ParserPlugin } from "./domain";

export class ParserRegistry {
  constructor(
    private readonly plugins: ParserPlugin[],
    private readonly fallback: ParserPlugin,
  ) {}

  parse(email: GmailSourceEmail) {
    const plugin = this.plugins.find((candidate) => candidate.canParse(email));
    return (plugin ?? this.fallback).parse(email);
  }
}

// Concrete plugin order:
// Mindbody -> Momence -> Vagaro -> Punchpass -> WellnessLiving -> Arketa ->
// Chinese translation preprocessor -> Generic AI.
// Each plugin owns sender detection and platform-specific field extraction while
// returning the same normalized DanceEvent interface.

export interface EmailTranslationService {
  canTranslate(text: string): boolean;
  translateToEnglish(email: GmailSourceEmail): Promise<GmailSourceEmail>;
}

// Translation is preprocessing. Parsers classify and extract fields only after
// non-English source content has an English representation. The original
// subject remains on DanceEvent for review and audit.
