import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" className="dark">
      <Head />
      <body className="bg-mauve-1 dark:bg-mauvedark-1 text-mauve-12 dark:text-mauvedark-12">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
