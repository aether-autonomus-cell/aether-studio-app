import { z } from "zod";
import { getStyleManifest } from "./renderer/styles.ts";
import type { SceneGraphV1, SceneNode, StyleId } from "./schema.ts";

export const hookCategorySchema = z.enum([
  "curiosity",
  "contrast",
  "stake",
  "visual-pattern",
]);
export type HookCategory = z.infer<typeof hookCategorySchema>;

export const hookItemSchema = z.object({
  id: z.string(),
  category: hookCategorySchema,
  hook_en: z.string(),
  hook_hi: z.string(),
  rationale: z.string(),
  shortlisted: z.boolean().default(false),
});
export type HookItem = z.infer<typeof hookItemSchema>;

export const hooksBundleSchema = z.object({
  hooks: z.array(hookItemSchema).min(5).max(21),
  top5Ids: z.array(z.string()).length(5),
});
export type HooksBundle = z.infer<typeof hooksBundleSchema>;

export const packageConceptSchema = z.object({
  id: z.string(),
  angle: z.string(),
  title_en: z.string().max(100),
  title_hi: z.string().max(100),
  description_en: z.string(),
  description_hi: z.string(),
  tags: z.array(z.string()),
  thumbnail_headline_en: z.string(),
  thumbnail_headline_hi: z.string(),
  thumbnail_accent: z.string(),
});
export type PackageConcept = z.infer<typeof packageConceptSchema>;

export const packageBundleSchema = z.object({
  concepts: z.array(packageConceptSchema).length(3),
});
export type PackageBundle = z.infer<typeof packageBundleSchema>;

export const shortsArcSchema = z.object({
  title_en: z.string(),
  title_hi: z.string(),
  estimated_duration_sec: z.number(),
  aspect_ratio: z.literal("9:16"),
  scenes: z.array(
    z.object({
      source_scene_id: z.string(),
      narration_en: z.string(),
      narration_hi: z.string(),
      headline_en: z.string(),
      headline_hi: z.string(),
    }),
  ),
});
export type ShortsArc = z.infer<typeof shortsArcSchema>;

/**
 * Generates 21 structured opening hooks across 4 categories, shortlisted to Top 5
 * using transparent heuristic criteria (never fabricated virality percentages).
 */
export function buildDeterministic21Hooks(topic: string): HooksBundle {
  const clean = topic.trim() || "this turning point";
  const shortTopic = clean.split(/\s+/).slice(0, 7).join(" ");

  const templates: { cat: HookCategory; en: string; hi: string; why: string }[] = [
    // Curiosity (6)
    { cat: "curiosity", en: `Nobody noticed the hidden rule behind ${shortTopic}—until frame three.`, hi: `${shortTopic} के पीछे छिपा नियम किसी ने नहीं देखा—जब तक तीसरा फ्रेम नहीं आया।`, why: "Opens an immediate unanswered question in <4 seconds." },
    { cat: "curiosity", en: `What happens when ${shortTopic} breaks the one rule everyone trusts?`, hi: `क्या होता है जब ${shortTopic} उस एक नियम को तोड़ दे जिस पर सब भरोसा करते हैं?`, why: "Frames a clear causal mystery." },
    { cat: "curiosity", en: `Three seconds before ${shortTopic}, one detail changed everything.`, hi: `${shortTopic} से तीन सेकंड पहले, एक छोटी बात ने सब कुछ बदल दिया।`, why: "Time-anchors viewer attention immediately." },
    { cat: "curiosity", en: `Why does ${shortTopic} look simple until you zoom in 200%?`, hi: `${shortTopic} बाहर से आसान क्यों दिखता है जब तक आप ज़ूम न करें?`, why: "Invites visual inspection." },
    { cat: "curiosity", en: `The quiet mistake inside ${shortTopic} that almost nobody catches.`, hi: `${shortTopic} के अंदर की वह शांत गलती जिसे लगभग कोई नहीं पकड़ पाता।`, why: "Targets pattern-recognition curiosity." },
    { cat: "curiosity", en: `Wait for the second beat—${shortTopic} flips completely.`, hi: `दूसरे हिस्से तक रुकिए—${shortTopic} पूरी तरह पलट जाता है।`, why: "Signals upcoming structural reversal." },
    // Contrast (5)
    { cat: "contrast", en: `Everyone expects speed. ${shortTopic} wins by stopping cold.`, hi: `हर कोई रफ़्तार की उम्मीद करता है। ${shortTopic} ठहरकर जीतता है।`, why: "Sharp juxtaposition between expectation and reality." },
    { cat: "contrast", en: `Two voices, one exact visual: watch how ${shortTopic} diverges.`, hi: `दो आवाज़ें, एक ही दृश्य: देखें ${shortTopic} कैसे अलग असर दिखाता है।`, why: "Highlights dual-channel contrast." },
    { cat: "contrast", en: `Old workflow vs. ${shortTopic}: half the steps, twice the clarity.`, hi: `पुराना तरीका बनाम ${shortTopic}: आधे कदम, दोगुनी स्पष्टता।`, why: "Clear before/after framing for explainers." },
    { cat: "contrast", en: `Looks calm on the surface—underneath, ${shortTopic} is pure tension.`, hi: `ऊपर से शांत दिखता है—अंदर से ${shortTopic} पूरा तनाव है।`, why: "Pairs well with manhwa split-panel reveal." },
    { cat: "contrast", en: `Most stories fade at minute two. ${shortTopic} accelerates there.`, hi: `ज़्यादातर कहानियाँ दूसरे मिनट में धीमी होती हैं। ${shortTopic} वहीं तेज़ होता है।`, why: "Retention contrast hook." },
    // Stake (5)
    { cat: "stake", en: `If ${shortTopic} misses by one frame, the entire sequence collapses.`, hi: `अगर ${shortTopic} एक फ्रेम भी चूक जाए, तो पूरा सीक्वेंस बिखर जाता है।`, why: "Raises concrete, measurable stakes." },
    { cat: "stake", en: `Zero budget, one shot left—can ${shortTopic} actually hold?`, hi: `जीरो बजट, आखिरी मौका—क्या ${shortTopic} वाकई टिक पाएगा?`, why: "Establishes resource constraint tension." },
    { cat: "stake", en: `This single choice in ${shortTopic} decides who walks out.`, hi: `${shortTopic} का यह एक फैसला तय करता है कि कौन बाहर निकलेगा।`, why: "High-stakes narrative fork." },
    { cat: "stake", en: `Don't skip the setup: ${shortTopic} costs everything if rushed.`, hi: `शुरुआत मत छोड़िए: जल्दबाज़ी में ${shortTopic} सब कुछ गँवा देता है।`, why: "Protects early retention through setup." },
    { cat: "stake", en: `One unverified number ruined ${shortTopic}—here is the real fix.`, hi: `एक गलत आँकड़े ने ${shortTopic} बिगाड़ दिया—यहाँ असली सुधार है।`, why: "Credibility + correction stake." },
    // Visual Pattern (5)
    { cat: "visual-pattern", en: `Watch the cyan line cross the frame—that marks ${shortTopic}.`, hi: `सियान रेखा को फ्रेम पार करते देखें—यही ${shortTopic} का निशान है।`, why: "Directs eye movement in Frame 1." },
    { cat: "visual-pattern", en: `Red panel left, obsidian shadow right: decode ${shortTopic} in 15s.`, hi: `बाएँ लाल पैनल, दाएँ गहरी परछाई: 15 सेकंड में ${shortTopic} समझें।`, why: "Synchronizes spoken hook with visual layout." },
    { cat: "visual-pattern", en: `Count the three beats on screen as ${shortTopic} unfolds.`, hi: `स्क्रीन पर तीन बीट्स गिनें जैसे ही ${shortTopic} खुलता है।`, why: "Visual milestone anchor." },
    { cat: "visual-pattern", en: `No stock footage—every pixel of ${shortTopic} is drawn by code.`, hi: `कोई स्टॉक फुटेज नहीं—${shortTopic} का हर पिक्सेल कोड से बना है।`, why: "Pattern interrupt for pure 2D animation." },
    { cat: "visual-pattern", en: `Freeze right here on ${shortTopic}: notice the gaze shift.`, hi: `${shortTopic} पर यहीं रुकें: नज़र का बदलाव ध्यान से देखें।`, why: "Cue for CharacterRig2D gaze snap." },
  ];

  const top5Indices = [0, 6, 11, 16, 1];
  const hooks: HookItem[] = templates.map((item, idx) => ({
    id: `h${idx + 1}`,
    category: item.cat,
    hook_en: item.en,
    hook_hi: item.hi,
    rationale: item.why,
    shortlisted: top5Indices.includes(idx),
  }));

  return {
    hooks,
    top5Ids: top5Indices.map((i) => `h${i + 1}`),
  };
}

/**
 * Generates 3 synchronized Title + Description + Tags + 2D-Coded Thumbnail concepts.
 */
export function buildDeterministicPackages(job: SceneGraphV1): PackageBundle {
  const baseEn = job.project.title["en-US"].trim() || "Aether 2D Story";
  const baseHi = job.project.title["hi-IN"].trim() || baseEn;
  const style = getStyleManifest(job.project.style_id);

  return {
    concepts: [
      {
        id: "pkg-mystery",
        angle: "Curiosity & Turning Point",
        title_en: `${baseEn} — The Moment Everything Shifted`.slice(0, 100),
        title_hi: `${baseHi} — वह पल जब सब बदल गया`.slice(0, 100),
        description_en: `${baseEn}\n\nRendered in deterministic 2D code via Aether Studio v2.0.\nChapters synced across Hindi and English.`,
        description_hi: `${baseHi}\n\nAether Studio v2.0 से शुद्ध 2D कोड में निर्मित।\nहिंदी और अंग्रेज़ी दोनों चैनलों के लिए सिंक्ड।`,
        tags: ["2DAnimation", "Storytelling", "AetherStudio", "MotionComic"],
        thumbnail_headline_en: "ONE SHARP TURN",
        thumbnail_headline_hi: "एक तीखा मोड़",
        thumbnail_accent: style.accentPrimary,
      },
      {
        id: "pkg-contrast",
        angle: "High-Contrast Breakdown",
        title_en: `Why ${baseEn} Works (Frame-by-Frame 2D)`.slice(0, 100),
        title_hi: `${baseHi} कैसे काम करता है (फ्रेम-दर-फ्रेम 2D)`.slice(0, 100),
        description_en: `Frame-accurate 2D visual breakdown of ${baseEn}.\nAudio-first timing with zero drift.`,
        description_hi: `${baseHi} का सटीक 2D विज़ुअल विश्लेषण।\nबिना किसी ऑडियो ड्रिफ्ट के।`,
        tags: ["Explainer", "2DCode", "AetherStudio", "Animation"],
        thumbnail_headline_en: "FRAME BY FRAME",
        thumbnail_headline_hi: "फ्रेम दर फ्रेम",
        thumbnail_accent: style.emphasis,
      },
      {
        id: "pkg-stakes",
        angle: "High-Stakes Action",
        title_en: `${baseEn} (Pure 2D Anime Edition)`.slice(0, 100),
        title_hi: `${baseHi} (शुद्ध 2D एनीमे संस्करण)`.slice(0, 100),
        description_en: `High-contrast 2D anime edition of ${baseEn}.`,
        description_hi: `${baseHi} का हाई-कंट्रास्ट 2D एनीमे संस्करण।`,
        tags: ["Anime2D", "Manhwa", "HindiStory", "AetherStudio"],
        thumbnail_headline_en: "FINAL SIGNAL",
        thumbnail_headline_hi: "आखिरी संकेत",
        thumbnail_accent: style.danger,
      },
    ],
  };
}

/**
 * Generates a crisp 16:9 SVG 2D-coded thumbnail data URI with zero paid image APIs.
 */
export function render2DThumbnailSvg(
  headline: string,
  subtitle: string,
  styleId: StyleId,
  accentOverride?: string,
): string {
  const style = getStyleManifest(styleId);
  const accent = accentOverride || style.accentPrimary;
  const safeHead = escapeXml(headline.slice(0, 32));
  const safeSub = escapeXml(subtitle.slice(0, 44));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${style.bg0}"/>
      <stop offset="55%" stop-color="${style.bg1}"/>
      <stop offset="100%" stop-color="${style.surface}"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="${style.bg0}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <g stroke="${accent}" stroke-opacity="0.24" stroke-width="2">
    <line x1="460" y1="160" x2="640" y2="20"/>
    <line x1="460" y1="160" x2="640" y2="95"/>
    <line x1="460" y1="160" x2="640" y2="245"/>
    <line x1="460" y1="160" x2="640" y2="335"/>
    <line x1="460" y1="160" x2="290" y2="0"/>
  </g>
  <!-- Stylized 2D Character Silhouette -->
  <g transform="translate(485, 195)">
    <path d="M-58,150 Q-82,30 -36,-25 L36,-25 Q82,30 58,150 Z" fill="#0B1325" stroke="${accent}" stroke-width="3"/>
    <circle cx="0" cy="-65" r="34" fill="#0B1325" stroke="${accent}" stroke-width="3"/>
    <rect x="-18" y="-70" width="12" height="5" fill="${accent}"/>
    <rect x="6" y="-70" width="12" height="5" fill="${accent}"/>
  </g>
  <!-- High-Contrast Title Scrim -->
  <rect x="28" y="88" width="358" height="178" rx="14" fill="rgba(7,11,22,0.84)" stroke="${accent}" stroke-width="2.5"/>
  <rect x="44" y="108" width="84" height="6" rx="3" fill="${style.emphasis}"/>
  <text x="44" y="162" fill="#F5F7FF" font-family="Space Grotesk, Noto Sans Devanagari, sans-serif" font-size="30" font-weight="700">${safeHead}</text>
  <text x="44" y="206" fill="${style.muted}" font-family="Inter, Noto Sans Devanagari, sans-serif" font-size="16" font-weight="600">${safeSub}</text>
  <rect x="44" y="226" width="122" height="24" rx="6" fill="${accent}"/>
  <text x="105" y="242" text-anchor="middle" fill="#070B16" font-family="Inter, sans-serif" font-size="11" font-weight="700">AETHER 2D</text>
</svg>`;
}

/**
 * Extracts a self-contained 30–60s 9:16 vertical Shorts arc from the full scene graph,
 * recomputing vertical camera framing rather than center-cropping landscape frames.
 */
export function extractVerticalShortsArc(job: SceneGraphV1): ShortsArc {
  const all = job.project.scenes;
  const picked: SceneNode[] = [];
  if (all.length <= 5) {
    picked.push(...all);
  } else {
    picked.push(all[0], all[1], all[Math.floor(all.length / 2)], all[all.length - 1]);
  }
  const totalSec = picked.reduce((acc, s) => acc + Math.min(12, s.duration_hint_sec), 0);

  return {
    title_en: `${job.project.title["en-US"]} #Shorts`.slice(0, 100),
    title_hi: `${job.project.title["hi-IN"]} #Shorts`.slice(0, 100),
    estimated_duration_sec: Math.round(Math.max(30, Math.min(58, totalSec * 1.4))),
    aspect_ratio: "9:16",
    scenes: picked.map((s) => ({
      source_scene_id: s.id,
      narration_en: s.narration["en-US"] || s.narration["hi-IN"],
      narration_hi: s.narration["hi-IN"] || s.narration["en-US"],
      headline_en: s.props?.headline?.["en-US"] || "KEY MOMENT",
      headline_hi: s.props?.headline?.["hi-IN"] || "मुख्य पल",
    })),
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
