# Myth / claim record (`data/safe-batch/myths.json`)

```jsonc
{
  "id": "rice-water-grows-hair",            // unique, lowercase-with-dashes, never changes
  "title": "Rice water makes hair grow faster",
  "topics": ["hair"],                        // see TOPICS in scripts/build.mjs
  "intro": "optional sentence before the claims",
  "claims": [                                // one entry per claim checked
    {
      "claim": "Rice water grows hair",
      "verdict": "false",                    // "true" | "false" | "partly" | "unproven" | null (legacy)
      "truth": "What is actually true, in plain words.",
      "grade": "C"                           // optional proof grade A-D
    }
  ],
  "body": "plain-text explanation (legacy records use this instead of claims)",
  "sources": [ { "title": "Study or page", "url": "https://..." } ],
  "seen_in": [ { "creator": "@name", "platform": "tiktok", "url": "https://..." } ],
  "checked": "2026-10-22",                   // date the evidence was last checked
  "format": "v2"                             // "v2" for new records, "legacy" for converted ones
}
```

New records (`format: "v2"`) must have `claims` with a verdict for each, at least one `source`, and a `checked` date. The validator enforces this.

# Recipe record (`data/safe-batch/recipes_checked.json`)

```jsonc
{
  "id": "tamarind-coffee-glow-scrub",        // unique, never changes (rename freely, keep the id)
  "name": "Tamarind coffee glow scrub (like Pangju Formula 01)",
  "claim": "...", "type": "body_rinse", "use": "store",
  "note": "...",
  "rows": [["sugar", 60, "g"], ["coffeepowder", 15, "g"]],
  "source": { "creator": "@pangju", "platform": "tiktok", "url": "https://...", "variant": "as-posted" }   // optional
}
```
