import { PDFParse } from "pdf-parse";

export async function extractPdfText(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
}> {
  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return {
      text: result.text ?? "",
      pageCount: result.total ?? result.pages?.length ?? 0,
    };
  } finally {
    await parser.destroy();
  }
}
