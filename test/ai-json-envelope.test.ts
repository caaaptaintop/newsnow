import { expect, it } from "vitest"
import { intelligenceParseAI } from "../server/utils/intelligence-ai"

it("accepts fenced JSON with outer newlines while retaining strict JSON validation", () => {
  const payload = "{\"items\":[{\"key\":\"a\",\"keep\":false}]}"
  for (const text of [payload, `\n\n\uFEFF\x20\x20\x20\x20\x60\x60\x60json\n${payload}\n\x60\x60\x60\n`, `\x60\x60\x60json\r\n${payload}\r\n\x60\x60\x60\r\n`, `<think>analysis</think>\n\x60\x60\x60json\n${payload}\n\x60\x60\x60\n`]) expect(intelligenceParseAI({ response: text })).toEqual([{ key: "a", keep: false }])
  for (const text of [`explanation\n${payload}`, `\x60\x60\x60json\n${payload}\n\x60\x60\x60\nextra`, "{\"items\":", "{}"]) expect(() => intelligenceParseAI({ response: text })).toThrow()
})
