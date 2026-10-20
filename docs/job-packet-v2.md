# Job packet v2

Shared contract for Aether Studio, the open-source worker, and every later account. The studio will not copy a packet that fails this schema. Source of truth in code: [`src/lib/studio/schema.ts`](../src/lib/studio/schema.ts).

Do not add account-specific fields without bumping `version`.

## Top level

| Field | Type | Rule |
| --- | --- | --- |
| `version` | `2` | Literal. |
| `language` | `"hi"` or `"en"` | Devanagari in the chapter text selects `hi`. Anything else is `en`. |
| `voice` | string | Male voice id. Default `hi-IN-MadhurNeural` or `en-IN-PrabhatNeural`. No female fallback. |
| `title` | string | Series or chapter title. |
| `chapters` | array, at least one | One object per source chapter. |
| `seo` | `{ title, description, tags }` | YouTube card text. Privacy (public, unlisted, or private) is chosen on the YouTube tab and is not copied into this packet. Upload stays on the author's channel. Sign-in is not part of v2. |
| `note` | string | Rights reminder. Paywalled pages are not fetched. |

## Chapter

| Field | Type |
| --- | --- |
| `index` | positive integer, the chapter number |
| `title` | string |
| `source_url` | string or `null` |
| `narration` | string, read by `voice` |
| `characters` | cast for this chapter |
| `scenes` | at least one scene |

### Character

`id`, `name`, `soul` (identity), `vessel` (current body, prose), `vessel_id` (same as `id`; tiles point here).

### Scene

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | Stable inside the chapter. |
| `caption` | string | Narration line under the panel. May be empty when the bubble carries the beat. |
| `sfx` | string | One short hit (`CRACK`, `SHING`) or empty. Drawn on top of the tile, never inside the prompt. |
| `state` | string | What changed in the vessel or place. |
| `bubble` | `{ speaker, text }` | Spoken line. `text` may be empty. `speaker` is the character name, or empty. |
| `tiles` | array, at least one | Pictures for this scene. |

### Tile

| Field | Type | Rule |
| --- | --- | --- |
| `prompt` | string | What to paint. No letters, logos, or speech balloons. |
| `negative` | string | What to refuse. Always includes text, logos, speech bubbles. |
| `characters` | string[] | Cast ids visible or speaking in this tile. |
| `vessel_id` | string | Cast id whose body is in frame. Empty string if the chapter names nobody. |

## Worker

When the phone is in **Live worker** mode it posts this packet to `{origin}/api/v1/jobs` with header `X-Aether-Token`. Health is `GET {origin}/api/v1/health` with the same header. The token is not part of the packet and is not written into the project file.

`POST /api/v1/jobs` returns JSON with `id` (also accepted: `job_id`, `jobId`). The studio then polls `GET /api/v1/jobs/{id}` with the same header.

Status JSON:

| Field | Rule |
| --- | --- |
| `status` or `state` | `queued`, `running`, `done`, or `error`. Close words (`processing`, `completed`, `failed`) are accepted. |
| `progress` | A number `0–1` or `0–100`, a percent string, or `{ current, total, label }`. |
| `error` | Shown when the job fails. Retry sends the same packet again. |
| `mp4_url` | Also `mp4Url`, `download_url`, `video_url`, or `output.url`. The studio downloads it with the token. If this is missing, it tries `GET /api/v1/jobs/{id}/mp4` on the worker host. |

The token stays in the browser tab (`sessionStorage` only). It is not copied into `job.json`.

## Example

```json
{
  "version": 2,
  "language": "en",
  "voice": "en-IN-PrabhatNeural",
  "title": "The Lantern Debt",
  "chapters": [
    {
      "index": 1,
      "title": "The Lantern Debt",
      "source_url": null,
      "narration": "Rain argued with the lanterns…",
      "characters": [
        {
          "id": "ren",
          "name": "Ren",
          "soul": "Pays what he owes.",
          "vessel": "Torn saffron robe, scar on the left cheek.",
          "vessel_id": "ren"
        }
      ],
      "scenes": [
        {
          "id": "s1",
          "caption": "Rain argued with the lanterns.",
          "sfx": "",
          "state": "Torn saffron robe, night rain",
          "bubble": { "speaker": "Ren", "text": "The pendant cracked because I paid the wrong debt." },
          "tiles": [
            {
              "prompt": "Vertical manhua panel, no text. Night rain on a stone bridge.",
              "negative": "text, letters, logos, watermark, speech bubbles, signature, extra limbs, deformed hands",
              "characters": ["ren"],
              "vessel_id": "ren"
            }
          ]
        }
      ]
    }
  ],
  "seo": { "title": "The Lantern Debt", "description": "Motion comic.", "tags": ["motion comic"] },
  "note": "Job packet v2."
}
```

The factory cell still accepts a legacy packet that has top-level `scenes` and no `chapters`. New copies are always version 2.
