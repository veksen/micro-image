import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const [originalContentLength, processedContentLength] = await Promise.all([
      fetch(req.query.originalSrc as string).then((res) => {
        return Number(res.headers.get("content-length"));
      }),
      fetch(req.query.currentSrc as string).then((res) => {
        return Number(res.headers.get("content-length"));
      }),
    ]);

    res.status(200).json({
      original: {
        src: req.query.originalSrc,
        contentLength: originalContentLength,
      },
      processed: {
        src: req.query.currentSrc,
        contentLength: processedContentLength,
      },
    });
  }
}
