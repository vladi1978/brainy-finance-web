import pdfParse from "pdf-parse";

export async function extractPdfText(buffer: Buffer): Promise<{
  text: string;
  pageCount: number;
}> {
  const data = await pdfParse(buffer);
  return {
    text: data.text ?? "",
    pageCount: data.numpages ?? 0,
  };
}
