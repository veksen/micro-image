import "../globals.css";
import type { AppProps } from "next/app";
import DocsLayout from "../layouts/docs";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <DocsLayout>
      <Component {...pageProps} />
    </DocsLayout>
  );
}
