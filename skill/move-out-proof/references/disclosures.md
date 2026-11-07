# Disclosures

## Third-party components and open source libraries

**Inside this Skill package:** none. The package is Markdown only (`SKILL.md` and the files in `references/`). It delegates every step to the UGREEN AI NAS assistant's own registered experts (photo-agent, document-agent, file-agent, knowledge-agent) and calls no outside service, library or model of its own.

**Outside the package** (used only to test and present the Skill, not shipped in it; source at https://github.com/itssaharsh/move-out-proof):

| Component | Used for | Source | Licence |
|---|---|---|---|
| UGREEN UGOS Skill Creation Tool 0.7.3 | capability catalog and the official static checker | https://ai.ugreen.com/pages/hackathon-starter-kit | UGREEN terms |
| exifr 7.1.3 | reading photo capture dates in the test emulator | https://github.com/MikeKovarik/exifr | MIT |
| Google Gemini API (Gemini 3.x Flash-Lite and others) | running the test emulator's agents | https://ai.google.dev | Google API terms |
| Vite, Preact, TypeScript | the replay web page | https://vitejs.dev, https://preactjs.com, https://www.typescriptlang.org | MIT, MIT, Apache-2.0 |
| Playwright | screenshots and the walkthrough recording | https://playwright.dev | Apache-2.0 |
| Newsreader, Hanken Grotesk, JetBrains Mono fonts (via Fontsource) | the replay web page | https://fontsource.org | SIL Open Font License 1.1 |
| Pillow | building the staged demo photos | https://python-pillow.org | MIT-CMU (HPND) |
| Demo photos (Wikimedia Commons) | the staged demo apartment | listed in `fixtures/apartment/CREDITS.md` in the repository | CC0 1.0, and one CC BY-SA 4.0 (Ronnica123) |

## Principal functionality built for this hackathon

All of it was built during the hackathon, starting on 6 November 2026: the Skill's workflow in `SKILL.md` (dated photo search per window, spot labelling with a fixed list, pairing by capture date, letter reading with an OCR fallback and a total check, approval before any write, the evidence album, folder and report, and gap mode), the spot list, the report format and the user guide. Outside the package: the test emulator, its scenarios and automated checks, the staged demo apartment and the replay page.

## AI tools used

- **Claude Code (Anthropic)**: planning, writing the Skill text and the test code, and reviewing it, used together with the UGREEN Skill Creation Tool's checker.
- **Google Gemini models**: run the agents inside the test emulator only. On a UGREEN NAS the Skill runs on the assistant's own models.
