import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { transcribeAudio } from "@/ipc/utils/local_transcribe";

const logger = log.scope("local_transcribe");

const transcribeSchema = z.object({
  audio_path: z.string().describe("Path to the audio file to transcribe"),
  language: z
    .string()
    .optional()
    .describe(
      "Language code (e.g. 'en', 'es', 'fr'). Auto-detects if omitted.",
    ),
});

const DESCRIPTION = `
Transcribe audio to text using the configured provider's Whisper API.

### When to Use
- Converting voice messages to text
- Transcribing recorded audio
- Processing audio inputs

### How It Works
1. Reads the audio file
2. Sends to provider's Whisper API
3. Returns transcribed text

### Supported Formats
- WAV, MP3, M4A, WEBM, MP4, MPEG, MPEGPS, WEBM
- FLV, WMV, 3GPP, OGG, OGA, OPUS
`;

export const localTranscribeTool: ToolDefinition<
  z.infer<typeof transcribeSchema>
> = {
  name: "local_transcribe",
  description: DESCRIPTION,
  inputSchema: transcribeSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Transcribe audio: ${args.audio_path}`,

  buildXml: (args, isComplete) => {
    if (!args.audio_path) return undefined;
    if (isComplete) return undefined;
    return `<dyad-transcribe path="${escapeXmlAttr(args.audio_path)}">Transcribing...</dyad-transcribe>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Transcribing audio: ${args.audio_path}`);

    ctx.onXmlStream(
      `<dyad-transcribe path="${escapeXmlAttr(args.audio_path)}">Processing audio...</dyad-transcribe>`,
    );

    try {
      const result = await transcribeAudio({
        audioPath: args.audio_path,
        language: args.language,
      });

      ctx.onXmlComplete(
        `<dyad-transcribe path="${escapeXmlAttr(args.audio_path)}" language="${escapeXmlAttr(result.language)}">\n${escapeXmlContent(result.text)}\n</dyad-transcribe>`,
      );

      return result.text;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
