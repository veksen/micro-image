import "../globals.css";
import type { ReactElement, ReactNode } from "react";
import type { AppProps } from "next/app";
import DocsLayout from "../layouts/docs";

type Page = AppProps["Component"] & { getLayout?: (page: ReactElement) => ReactNode };

export default function App({ Component, pageProps }: AppProps & { Component: Page }) {
  const getLayout = Component.getLayout ?? ((page) => <DocsLayout>{page}</DocsLayout>);
  return getLayout(<Component {...pageProps} />);
}
