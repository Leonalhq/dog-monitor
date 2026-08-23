import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { Database, StoredDog } from "../db/database.js";
import { fetchText } from "../lib/http.js";

export interface DogAnalysis {
  strengths: string[];
  challenges: string[];
  beginnerSuitability: string;
  suitableHome: string[];
  questionsForShelter: string[];
  unknowns: string[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

const clean = (value: string): string => value.replace(/\s+/g, " ").trim();

export function extractReadableText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, header, footer, form").remove();
  const meta = clean($("meta[name='description']").attr("content") ?? "");
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body");
  const parts: string[] = [];
  root.find("*").addBack().contents().each((_index, node) => {
    if (node.type === "text" && clean(node.data)) parts.push(clean(node.data));
  });
  const body = parts.join(" ");
  return clean(`${meta} ${body}`).slice(0, 20_000);
}

function dogFacts(dog: StoredDog): string {
  return [
    `Name: ${dog.name}`,
    dog.breed ? `Breed: ${dog.breed}` : "",
    dog.age ? `Age: ${dog.age}` : "",
    dog.sex ? `Sex: ${dog.sex}` : "",
    dog.location ? `Location: ${dog.location}` : "",
    dog.status ? `Status: ${dog.status}` : "",
    dog.description ? `Listing description: ${dog.description}` : ""
  ].filter(Boolean).join("\n");
}

export class DogAnalyzer {
  constructor(
    private readonly database: Database,
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite"
  ) {}

  async analyze(dogId: number): Promise<{ analysis: DogAnalysis; cached: boolean }> {
    const dog = this.database.getDog(dogId);
    if (!dog) throw new Error("Dog not found in the database");

    let pageText = "";
    try {
      pageText = extractReadableText(await fetchText(dog.profile_url));
    } catch {
      // Stored listing fields can still produce a cautious analysis.
    }
    const evidence = `${dogFacts(dog)}\n\nProfile page:\n${pageText}`.trim();
    if (evidence.length < 100) throw new Error("The shelter has not published enough information to analyze this dog");

    const contentHash = createHash("sha256").update(evidence).digest("hex");
    if (dog.analysis_content_hash === contentHash && dog.analysis_json) {
      return { analysis: JSON.parse(dog.analysis_json) as DogAnalysis, cached: true };
    }
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: evidence }] }],
          systemInstruction: { parts: [{ text: [
            "Analyze this adoptable dog using only the supplied shelter evidence.",
            "Reply in concise Simplified Chinese. Never invent temperament, medical, training, child, cat, or dog compatibility.",
            "Put missing decision-critical facts in unknowns. beginnerSuitability must explain uncertainty, not give a guarantee."
          ].join(" ") }] },
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 900,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                strengths: { type: "ARRAY", items: { type: "STRING" } },
                challenges: { type: "ARRAY", items: { type: "STRING" } },
                beginnerSuitability: { type: "STRING" },
                suitableHome: { type: "ARRAY", items: { type: "STRING" } },
                questionsForShelter: { type: "ARRAY", items: { type: "STRING" } },
                unknowns: { type: "ARRAY", items: { type: "STRING" } }
              },
              required: [
                "strengths", "challenges", "beginnerSuitability", "suitableHome",
                "questionsForShelter", "unknowns"
              ]
            }
          }
        }),
        signal: AbortSignal.timeout(45_000)
      }
    );
    const result = await response.json() as GeminiResponse;
    if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${result.error?.message ?? "unknown error"}`);
    const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) throw new Error("Gemini returned no analysis");
    const analysis = JSON.parse(text) as DogAnalysis;
    this.database.saveAnalysis(dogId, contentHash, JSON.stringify(analysis));
    return { analysis, cached: false };
  }
}

export function formatAnalysis(analysis: DogAnalysis, cached: boolean): string {
  const section = (title: string, values: string[]): string =>
    `**${title}**\n${values.length ? values.map((value) => `• ${value}`).join("\n") : "• 资料不足"}`;
  return [
    section("优点", analysis.strengths),
    section("潜在挑战", analysis.challenges),
    `**适合新手吗**\n${analysis.beginnerSuitability}`,
    section("适合的家庭", analysis.suitableHome),
    section("建议询问救助中心", analysis.questionsForShelter),
    section("目前未知", analysis.unknowns),
    cached ? "_来自缓存；救助资料变化后会重新分析。_" : "_仅根据救助中心公开资料分析。_"
  ].join("\n\n").slice(0, 1_950);
}
