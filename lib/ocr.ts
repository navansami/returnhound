import { CATEGORIES, STORAGE_LOCATIONS, formParseSchema, type FormParse } from "@/lib/validators";

/**
 * Pluggable vision provider for reading photographed Lost & Found forms.
 * Today this is Google Gemini's free tier (a vision model, not a classic OCR
 * engine — the only free option that's accurate on messy handwriting). The
 * narrow `parseLostFoundForm` surface keeps the provider swappable (e.g.
 * self-hosted TrOCR / Ollama) without touching callers.
 */

export type ParseResult = { ok: true; data: FormParse } | { ok: false; error: string };

/** Free tier key from https://aistudio.google.com. Mirror it in Vercel env. */
const API_KEY = process.env.GEMINI_API_KEY;
/**
 * Current Flash vision model. gemini-2.5-flash is no longer available to new
 * keys, so keep this on a 3.x model (3.x also rejects `temperature`).
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

/**
 * Field-by-field instructions for reading the paper RS form. The critical
 * rule is that blank or illegible handwriting must come back empty rather than
 * invented — that's what keeps accuracy high on messy script.
 */
const FORM_PROMPT = `You are reading a handwritten Lost & Found log form used by a hotel's Royal Service desk.

The form has these fields, written by hand:
- foundAt: the date and time the item was found
- foundLocation: where the item was found (e.g. "Lobby", "Room 1204")
- finderName: the staff member who found the item
- finderDepartment: that staff member's department
- finderEmployeeId: that staff member's employee/ID number
- storageLocation: where the item was put away — one of: lost_found_store, security, office
- storageDetail: any extra detail such as a cupboard, shelf, or locker number
- comments: anything in the notes/comments box
- items: every item listed on the form, each with a name, a short description, and a category

Rules — follow them exactly:
1. Transcribe precisely what is written. Do not summarise or "clean up" the text.
2. For any field that is blank, empty, crossed out, or whose handwriting is illegible, return an EMPTY STRING (""). Never guess, never invent a plausible value, never auto-correct a name you are unsure of.
3. storageLocation must be one of: lost_found_store, security, office. If blank or illegible, return "".
4. category must be one of: general, food, alcohol, electronics, clothing, jewellery, currency, documents, other. If blank or illegible, return "".
5. foundAt: if the date/time is legible, return it as ISO-8601 like "2026-08-12T14:30". If only a date is written, use "2026-08-12T00:00". If not legible, return "".
6. Transcribe every item on the form, including the smallest detail in each description.

Respond with JSON only, matching the provided schema exactly.`;

/** Structured-output schema sent to Gemini so the response matches `formParseSchema`. */
const FORM_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    foundAt: { type: "string" },
    foundLocation: { type: "string" },
    finderName: { type: "string" },
    finderDepartment: { type: "string" },
    finderEmployeeId: { type: "string" },
    storageLocation: { type: "string", enum: [...STORAGE_LOCATIONS] },
    storageDetail: { type: "string" },
    comments: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
        },
        required: ["name", "description", "category"],
      },
    },
  },
  required: [
    "foundAt",
    "foundLocation",
    "finderName",
    "finderDepartment",
    "finderEmployeeId",
    "storageLocation",
    "storageDetail",
    "comments",
    "items",
  ],
} as const;

/** Read a photographed paper RS form and return the parsed fields. */
export async function parseLostFoundForm(imageUrl: string): Promise<ParseResult> {
  if (!API_KEY) {
    return { ok: false, error: "GEMINI_API_KEY is not set — add it to enable form parsing." };
  }

  // The image is a Cloudinary secure_url (already uploaded when the draft was
  // created). Fetch it server-side and inline it, since Gemini can't fetch URLs.
  let imageBytes: ArrayBuffer;
  try {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) return { ok: false, error: "Couldn't download the form photo for parsing." };
    imageBytes = await imageRes.arrayBuffer();
  } catch {
    return { ok: false, error: "Couldn't download the form photo for parsing." };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Header (not query param) so the key never lands in a URL/access log.
          "x-goog-api-key": API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: FORM_PROMPT },
                {
                  inline_data: {
                    mime_type: "image/jpeg",
                    data: Buffer.from(imageBytes).toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            // Note: Gemini 3.x does not support temperature/top_p — omit them.
            responseMimeType: "application/json",
            responseSchema: FORM_RESPONSE_SCHEMA,
          },
        }),
      },
    );

    if (!res.ok) {
      if (res.status === 429) return { ok: false, error: "Vision API is rate-limited — try again in a moment." };
      return { ok: false, error: `Vision API error (${res.status}).` };
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { ok: false, error: "The model returned no readable result." };

    const parsed = formParseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, error: "The model's response didn't match the form structure." };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: "Failed to parse the form. Please try again." };
  }
}
